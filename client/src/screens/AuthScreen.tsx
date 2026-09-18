import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../supabase";
import { Button } from "../components";
import { mono, theme } from "../theme";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "Account created — check email to confirm (if required), then sign in.");
    setBusy(false);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>House of Ghouls</Text>
        <Text style={styles.sub}>Enter the shared world.</Text>
        <TextInput
          style={styles.field}
          placeholder="email"
          placeholderTextColor={theme.dim}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.field}
          placeholder="password"
          placeholderTextColor={theme.dim}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {msg && <Text style={styles.msg}>{msg}</Text>}
        {busy ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 8 }} />
        ) : (
          <>
            <Button label="Sign in" onPress={signIn} />
            <Button label="Create account" kind="ghost" onPress={signUp} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, padding: 16 },
  card: { width: "100%", maxWidth: 380, backgroundColor: theme.panel, borderRadius: 12, borderWidth: 1, borderColor: theme.panelBorder, padding: 22, gap: 10 },
  title: { color: theme.accent, fontSize: 26, fontWeight: "800", fontFamily: mono, textAlign: "center" },
  sub: { color: theme.dim, textAlign: "center", marginBottom: 10 },
  field: { backgroundColor: theme.input, color: theme.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontFamily: mono, borderWidth: 1, borderColor: theme.panelBorder },
  msg: { color: theme.gold, fontSize: 13, textAlign: "center" },
});
