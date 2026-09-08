import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { NauticalBackground } from "../components/NauticalBackground";
import { ServerSettingsPanel } from "../components/ServerSettingsPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { envReady } from "../lib/config";
import { supabase } from "../lib/supabase";
import { loadVisionSession } from "../lib/session";
import { useTheme } from "../theme/ThemeContext";
import type { ThemeColors } from "../theme/colors";
import type { VisionSession } from "../types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: VisionSession) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(envReady());
  const passwordRef = useRef<TextInput>(null);

  const trimmedEmail = email.trim();
  const canSubmit = trimmedEmail.length > 0 && password.length > 0 && !busy;

  const onSubmit = async () => {
    const envError = envReady();
    if (envError) {
      setError(envError);
      return;
    }
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
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
      <NauticalBackground
        icons={[
          { name: "ferry", size: 300, opacity: 0.22, style: { bottom: -50, right: -70, transform: [{ rotate: "-8deg" }] } },
          { name: "ship-wheel", size: 140, opacity: 0.18, style: { top: 80, left: -45, transform: [{ rotate: "12deg" }] } },
          { name: "anchor", size: 90, opacity: 0.14, style: { bottom: 40, left: -20, transform: [{ rotate: "-15deg" }] } },
          { name: "waves", size: 30, opacity: 0.2, style: { top: "40%", left: 24 } },
          { name: "waves", size: 30, opacity: 0.16, style: { top: "46%", left: 70 } },
        ]}
      />

      <View style={styles.toggleRow}>
        <ThemeToggle />
      </View>
      <View style={styles.card}>
        <View style={styles.brand}>
          <View style={styles.anchorBadge}>
            <MaterialCommunityIcons name="anchor" size={26} color={colors.accentText} />
          </View>
          <View>
            <Text style={styles.kicker}>VisionM</Text>
            <Text style={styles.title}>Corrosion Inspect</Text>
          </View>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          placeholder="you@company.com"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordWrap}>
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            secureTextEntry={!showPassword}
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={() => canSubmit && onSubmit()}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
          />
          <Pressable
            hitSlop={10}
            style={styles.eyeBtn}
            onPress={() => setShowPassword((v) => !v)}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
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

      <View style={styles.logosRow}>
        <Image
          source={require("../../assets/logos/indian navy logo.png")}
          style={styles.navyLogo}
          resizeMode="contain"
        />
        <Image
          source={require("../../assets/logos/GSN Solutions 3.png")}
          style={styles.companyLogo}
          resizeMode="contain"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: "center",
      padding: 24,
    },
    toggleRow: { position: "absolute", top: 52, right: 24, zIndex: 1 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 12 },
    anchorBadge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: `${colors.accent}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    kicker: {
      color: colors.accentText,
      fontWeight: "700",
      letterSpacing: 1.2,
      fontSize: 12,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: "700",
    },
    label: {
      color: colors.textSecondary,
      marginBottom: 6,
      marginTop: 8,
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    passwordWrap: {
      position: "relative",
      justifyContent: "center",
    },
    passwordInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 10,
      color: colors.textPrimary,
      paddingHorizontal: 12,
      paddingRight: 44,
      paddingVertical: 12,
    },
    eyeBtn: {
      position: "absolute",
      right: 12,
    },
    error: {
      color: colors.danger,
      marginTop: 12,
    },
    button: {
      backgroundColor: colors.accent,
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
    logosRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 32,
      marginTop: 24,
    },
    navyLogo: { width: 56, height: 72 },
    companyLogo: { width: 180, height: 110 },
  });
}
