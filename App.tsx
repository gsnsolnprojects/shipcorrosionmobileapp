import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Animated, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ProjectScreen } from "./src/screens/ProjectScreen";
import { SurveyListScreen } from "./src/screens/SurveyListScreen";
import { SurveyDashboardScreen } from "./src/screens/SurveyDashboardScreen";
import { CaptureScreen } from "./src/screens/CaptureScreen";
import { ProgressScreen } from "./src/screens/ProgressScreen";
import { ResultsScreen } from "./src/screens/ResultsScreen";
import { ResurveyCaptureScreen, type ResurveyBaseline } from "./src/screens/ResurveyCaptureScreen";
import { confirmInferencePart, getInferenceResults, setUnauthorizedHandler, startInspect } from "./src/lib/api";
import { appendOnDeviceResult, confirmOnDeviceResult } from "./src/lib/confirmOnDevice";
import { loadApiBaseUrlOverride } from "./src/lib/config";
import { enqueueAppendResult, enqueueOnDeviceResult, getQueueForSurvey } from "./src/lib/offlineQueue";
import { loadVisionSession } from "./src/lib/session";
import { supabase } from "./src/lib/supabase";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import type { Assessment, CaptureExtras, InspectResults, LocalPhoto, PhotoMatch, VisionSession } from "./src/types";

type Screen =
  | "boot"
  | "login"
  | "home"
  | "settings"
  | "project"
  | "surveys"
  | "survey"
  | "capture"
  | "resurvey"
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
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const { colors, scheme } = useTheme();
  const statusBarStyle = scheme === "dark" ? "light" : "dark";
  const [screen, setScreen] = useState<Screen>("boot");
  const [session, setSession] = useState<VisionSession | null>(null);
  const [projectName, setProjectName] = useState("");
  const [surveyName, setSurveyName] = useState("");
  const [regionName, setRegionName] = useState("");
  const [inferenceId, setInferenceId] = useState<string | null>(null);
  const [results, setResults] = useState<InspectResults | null>(null);
  // Set only while adding a missed photo to an already-surveyed part —
  // capture screen jumps straight to on-device + append instead of a new visit.
  const [appendTargetId, setAppendTargetId] = useState<string | null>(null);
  // Set only while editing a STILL-QUEUED (not yet synced) part in place.
  const [editQueuedPart, setEditQueuedPart] = useState<{ id: string; initialPhotos: LocalPhoto[] } | null>(null);
  // Set only while resurveying a part — the baseline job being re-shot, and
  // the survey the new entry will be filed under (may differ from the
  // survey dashboard `surveyName` currently on screen, e.g. resurveying a
  // part from a past, already-closed survey into a brand-new one).
  const [resurveyBaseline, setResurveyBaseline] = useState<ResurveyBaseline | null>(null);
  const [resurveyTargetSurveyName, setResurveyTargetSurveyName] = useState("");
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
          setScreen("home");
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

  const onUpload = async (name: string, photos: LocalPhoto[], extras: CaptureExtras) => {
    if (!session) return;
    const started = await startInspect(session, projectName, surveyName, name, photos, undefined, undefined, extras);
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

  const onOnDeviceInspect = (nextResults: InspectResults) => {
    setRegionName(nextResults.regionName || "");
    setInferenceId(null);
    setResults(nextResults);
    setScreen("results");
  };

  // Confirming an on-device preview uploads the same already-annotated
  // images and already-computed stats as-is — the server does not re-run
  // inference. The preview alone is never saved; only this makes it a
  // permanent survey part. Falls back to the offline queue if unreachable,
  // same as the normal "Upload & inspect" button.
  const confirmOnDeviceUpload = async (assessment?: Assessment) => {
    if (!session || !results) return;
    // The inspector's severity/damage assessment rides along with the upload.
    const withAssessment: InspectResults = assessment ? { ...results, assessment } : results;

    let created: { inferenceId: string };
    try {
      created = await confirmOnDeviceResult(session, projectName, surveyName, regionName, withAssessment);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      await enqueueOnDeviceResult({
        companyId: session.companyId,
        companyName: session.companyName,
        projectName,
        surveyName,
        regionName,
        results: withAssessment,
      });
      Alert.alert(
        "Saved offline",
        `"${regionName}" is queued. It'll be added to the survey automatically next time you're online.`
      );
      setResults(null);
      setInferenceId(null);
      setScreen("survey");
      return;
    }

    const next = await getInferenceResults(session, created.inferenceId);
    try {
      await confirmInferencePart(session, created.inferenceId);
      next.confirmed = true;
    } catch {
      // Best-effort — the user can still tap Confirm manually on the results screen.
    }
    setInferenceId(created.inferenceId);
    setResults(next);
    setScreen("results");
  };

  // Adds a missed photo's on-device results to an ALREADY-SURVEYED part's
  // existing job, instead of creating a new visit. Falls back to the offline
  // queue if unreachable, same pattern as confirmOnDeviceUpload above.
  const appendPhotosToPart = async (appendResults: InspectResults) => {
    if (!session || !appendTargetId) return;
    const targetId = appendTargetId;
    try {
      const uploaded = await appendOnDeviceResult(session, targetId, appendResults);
      Alert.alert("Added", `Added ${uploaded.addedImages} photo(s) to "${regionName}".`);
    } catch (err) {
      if (!(err instanceof TypeError)) {
        Alert.alert("Add photo failed", err instanceof Error ? err.message : "Try again.");
        setAppendTargetId(null);
        setScreen("survey");
        return;
      }
      await enqueueAppendResult({
        companyId: session.companyId,
        companyName: session.companyName,
        projectName,
        surveyName,
        regionName,
        targetInferenceId: targetId,
        results: appendResults,
      });
      Alert.alert(
        "Saved offline",
        `Photo(s) queued. They'll be added to "${regionName}" automatically next time you're online.`
      );
    }
    setAppendTargetId(null);
    setScreen("survey");
  };

  // Opens a still-queued (not yet synced) part for editing — looks up its
  // current photo/image set so the capture screen can seed its thumbnails
  // and diff against them on save.
  const onEditQueuedPart = async (area: string, queuedPartId: string) => {
    const queue = await getQueueForSurvey(projectName, surveyName);
    const found = queue.find((p) => p.id === queuedPartId);
    if (!found || found.kind === "append") return;
    const initialPhotos: LocalPhoto[] =
      found.kind === "upload"
        ? found.photos
        : found.images.map((img) => ({ uri: img.uri, fileName: img.filename, mimeType: "image/png" }));
    setRegionName(area);
    setResults(null);
    setInferenceId(null);
    setAppendTargetId(null);
    setEditQueuedPart({ id: queuedPartId, initialPhotos });
    setScreen("capture");
  };

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

  // Loads a past job's photos as the baseline for a guided resurvey, then
  // opens the resurvey screen. `targetSurveyName` is where the new entry
  // will be filed — the already-open survey for Entry 2, or a freshly
  // named one for Entry 1 (resurveying from a past, closed survey).
  const startResurvey = async (baselineInferenceId: string, area: string, targetSurveyName: string) => {
    if (!session) return;
    try {
      const baselineResults = await getInferenceResults(session, baselineInferenceId);
      setResurveyTargetSurveyName(targetSurveyName);
      setResurveyBaseline({
        inferenceId: baselineInferenceId,
        regionName: baselineResults.regionName || area,
        images: baselineResults.images,
      });
      setScreen("resurvey");
    } catch (err) {
      Alert.alert("Could not load previous survey", err instanceof Error ? err.message : "Try again.");
    }
  };

  // On-device resurvey results already carry `baselineInferenceId`/
  // per-image `matchedBaselineFilename` — same shape as a normal on-device
  // preview, just with those extra fields, so this only needs to also move
  // `surveyName` state to the resurvey's target survey before showing results.
  const onResurveyOnDeviceInspect = (nextResults: InspectResults) => {
    setSurveyName(nextResults.surveyName || resurveyTargetSurveyName);
    setRegionName(nextResults.regionName || "");
    setInferenceId(null);
    setResults(nextResults);
    setScreen("results");
  };

  const onResurveySubmitServer = async (
    name: string,
    photos: LocalPhoto[],
    baseline: ResurveyBaseline,
    photoMatches: PhotoMatch[],
    notes: string
  ) => {
    if (!session) return;
    const started = await startInspect(
      session,
      projectName,
      resurveyTargetSurveyName,
      name,
      photos,
      baseline.inferenceId,
      photoMatches,
      { notes }
    );
    setSurveyName(resurveyTargetSurveyName);
    setRegionName(name);
    setInferenceId(started.inferenceId);
    setScreen("progress");
  };

  if (screen === "boot") {
    return (
      <View style={[styles.boot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
        <StatusBar style={statusBarStyle} />
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
              setScreen("home");
            }}
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
      </>
    );
  }

  if (screen === "home") {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <HomeScreen
            session={session}
            onChooseProject={() => setScreen("project")}
            onOpenSettings={() => setScreen("settings")}
            onSignOut={signOut}
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
      </>
    );
  }

  if (screen === "settings") {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <SettingsScreen onBack={() => setScreen("home")} onSignOut={signOut} />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
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
            onBack={() => setScreen("home")}
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
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
        <StatusBar style={statusBarStyle} />
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
              setAppendTargetId(null);
              setEditQueuedPart(null);
              setScreen("capture");
            }}
            onAddPartWithArea={(area) => {
              setRegionName(area);
              setResults(null);
              setInferenceId(null);
              setAppendTargetId(null);
              setEditQueuedPart(null);
              setScreen("capture");
            }}
            onAddPhotosToPart={(area, targetInferenceId) => {
              setRegionName(area);
              setResults(null);
              setInferenceId(null);
              setAppendTargetId(targetInferenceId);
              setEditQueuedPart(null);
              setScreen("capture");
            }}
            onEditQueuedPart={onEditQueuedPart}
            onOpenVisit={openVisitResults}
            onStartResurvey={(area, baselineInferenceId, targetSurveyName) =>
              startResurvey(baselineInferenceId, area, targetSurveyName)
            }
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
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
        <StatusBar style={statusBarStyle} />
      </>
    );
  }

  if (screen === "resurvey" && resurveyBaseline) {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <ResurveyCaptureScreen
            session={session}
            projectName={projectName}
            surveyName={resurveyTargetSurveyName}
            baseline={resurveyBaseline}
            onBack={() => {
              setResurveyBaseline(null);
              setScreen("survey");
            }}
            onSubmitOnDevice={onResurveyOnDeviceInspect}
            onSubmitServer={onResurveySubmitServer}
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
      </>
    );
  }

  if (screen === "results" && results) {
    return (
      <>
        <FadeInScreen screenKey={screen}>
          <ResultsScreen
            key={results.inferenceId}
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
            onAddMorePhotos={() => {
              setResults(null);
              setInferenceId(null);
              setScreen("capture");
            }}
            onConfirmOnDeviceUpload={confirmOnDeviceUpload}
          />
        </FadeInScreen>
        <StatusBar style={statusBarStyle} />
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
          initialRegionName={regionName}
          appendTargetId={appendTargetId ?? undefined}
          editQueuedPart={editQueuedPart ?? undefined}
          onBack={() => {
            setAppendTargetId(null);
            setEditQueuedPart(null);
            setScreen("survey");
          }}
          onUpload={onUpload}
          onOnDeviceInspect={onOnDeviceInspect}
          onAppendInspect={appendPhotosToPart}
          onResurvey={(baselineInferenceId, area) => startResurvey(baselineInferenceId, area, surveyName)}
        />
      </FadeInScreen>
      <StatusBar style={statusBarStyle} />
    </>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
});
