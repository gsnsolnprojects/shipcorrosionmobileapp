import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Animated, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ProjectScreen } from "./src/screens/ProjectScreen";
import { SurveyListScreen } from "./src/screens/SurveyListScreen";
import { SurveyDashboardScreen } from "./src/screens/SurveyDashboardScreen";
import { CaptureScreen } from "./src/screens/CaptureScreen";
import { ProgressScreen } from "./src/screens/ProgressScreen";
import { ResultsScreen } from "./src/screens/ResultsScreen";
import { getInferenceResults, setUnauthorizedHandler, startInspect } from "./src/lib/api";
import { loadApiBaseUrlOverride } from "./src/lib/config";
import { loadVisionSession } from "./src/lib/session";
import { supabase } from "./src/lib/supabase";
import type { InspectResults, LocalPhoto, VisionSession } from "./src/types";

type Screen =
  | "boot"
  | "login"
  | "project"
  | "surveys"
  | "survey"
  | "capture"
  | "progress"
  | "results";

function FadeInScreen({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [screenKey, opacity]);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [session, setSession] = useState<VisionSession | null>(null);
  const [projectName, setProjectName] = useState("");
  const [surveyName, setSurveyName] = useState("");
  const [regionName, setRegionName] = useState("");
  const [inferenceId, setInferenceId] = useState<string | null>(null);
  const [results, setResults] = useState<InspectResults | null>(null);
  const signingOutRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadApiBaseUrlOverride();
        if (cancelled) return;
        const existing = await loadVisionSession();
        if (cancelled) return;
        if (existing?.companyName) {
          setSession(existing);
          setScreen("project");
        } else {
          setScreen("login");
        }
      } catch {
        if (!cancelled) setScreen("login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProjectName("");
    setSurveyName("");
    setRegionName("");
    setInferenceId(null);
    setResults(null);
    setScreen("login");
  };

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (signingOutRef.current) return;
      signingOutRef.current = true;
      Alert.alert("Session expired", "Please log in again.");
      signOut().finally(() => {
        signingOutRef.current = false;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUpload = async (name: string, photos: LocalPhoto[]) => {
    if (!session) return;
    const started = await startInspect(session, projectName, surveyName, name, photos);
    setRegionName(name);
    setInferenceId(started.inferenceId);
    setScreen("progress");
  };

  const onCompleted = useCallback(async () => {
    if (!session || !inferenceId) return;
    try {
      const next = await getInferenceResults(session, inferenceId);
      setResults(next);
      setScreen("results");
    } catch (err) {
      Alert.alert("Results failed", err instanceof Error ? err.message : "Could not load results.");
      setScreen("capture");
    }
  }, [session, inferenceId]);

  const onFailed = useCallback((message: string) => {
    Alert.alert("Inspect failed", message);
    setScreen("capture");
  }, []);

  const openVisitResults = async (id: string) => {
    if (!session) return;
    try {
      const next = await getInferenceResults(session, id);
      setInferenceId(id);
      setResults(next);
      setRegionName(next.regionName || "");
      setScreen("results");
    } catch (err) {
      Alert.alert("Could not open part", err instanceof Error ? err.message : "Try again.");
    }
  };

  if (screen === "boot") {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color="#f97316" size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  if (screen === "login" || !session) {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <LoginScreen
            onLoggedIn={(next) => {
              setSession(next);
              setScreen("project");
            }}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "project") {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <ProjectScreen
            session={session}
            onSelect={(name) => {
              setProjectName(name);
              setScreen("surveys");
            }}
            onSignOut={signOut}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "surveys") {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <SurveyListScreen
            session={session}
            projectName={projectName}
            onBack={() => setScreen("project")}
            onOpenSurvey={(name) => {
              setSurveyName(name);
              setScreen("survey");
            }}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "survey") {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <SurveyDashboardScreen
            session={session}
            projectName={projectName}
            surveyName={surveyName}
            onBack={() => setScreen("surveys")}
            onAddPart={() => {
              setRegionName("");
              setResults(null);
              setInferenceId(null);
              setScreen("capture");
            }}
            onOpenVisit={openVisitResults}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "progress" && inferenceId) {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <ProgressScreen
            session={session}
            inferenceId={inferenceId}
            regionName={regionName}
            onCompleted={onCompleted}
            onFailed={onFailed}
            onCancelView={() => setScreen("survey")}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  if (screen === "results" && results) {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <ResultsScreen
            session={session}
            results={results}
            onBackToSurvey={() => {
              setResults(null);
              setInferenceId(null);
              setScreen("survey");
            }}
            onNewInspect={() => {
              setResults(null);
              setInferenceId(null);
              setRegionName("");
              setScreen("capture");
            }}
          />
        </FadeInScreen>
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <FadeInScreen screenKey={screen}>
        <CaptureScreen
          session={session}
          projectName={projectName}
          surveyName={surveyName}
          onBack={() => setScreen("survey")}
          onUpload={onUpload}
        />
      </FadeInScreen>
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
});
