import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ServerSettingsPanel } from "../components/ServerSettingsPanel";
import { envReady } from "../lib/config";
import { supabase } from "../lib/supabase";
import { loadVisionSession } from "../lib/session";
import type { VisionSession } from "../types";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: VisionSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(envReady());

  const onSubmit = async () => {
    const envError = envReady();
    if (envError) {
      setError(envError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw new Error(authError.message);
      const session = await loadVisionSession();
      if (!session) throw new Error("Logged in but profile was not found.");
      if (!session.companyName) {
        throw new Error("Your account has no workspace company. Use the web app to join a company first.");
      }
      onLoggedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.kicker}>VisionM</Text>
        <Text style={styles.title}>Corrosion inspect</Text>
        <Text style={styles.sub}>Same account as the web app. The phone does not pick a model.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@company.com"
          placeholderTextColor="#64748b"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#64748b"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={onSubmit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.buttonText}>Log in</Text>
            </>
          )}
        </Pressable>

        <ServerSettingsPanel onSaved={() => setError(envReady())} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  kicker: {
    color: "#fb923c",
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "700",
  },
  sub: {
    color: "#94a3b8",
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  label: {
    color: "#cbd5e1",
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  error: {
    color: "#fca5a5",
    marginTop: 12,
  },
  button: {
    backgroundColor: "#ea580c",
    marginTop: 20,
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
