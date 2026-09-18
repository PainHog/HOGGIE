import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./src/supabase";
import { AuthScreen } from "./src/screens/AuthScreen";
import { GameRoot } from "./src/screens/GameRoot";
import { mono, theme } from "./src/theme";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {!supabaseConfigured ? (
        <View style={styles.center}>
          <Text style={styles.title}>House of Ghouls</Text>
          <Text style={styles.msg}>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in client/.env
            (copy from client/.env.example), then restart.
          </Text>
        </View>
      ) : !ready ? null : !session ? (
        <AuthScreen />
      ) : (
        <GameRoot token={session.access_token} onSignOut={() => void supabase.auth.signOut()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { color: theme.accent, fontSize: 24, fontWeight: "800", fontFamily: mono },
  msg: { color: theme.dim, textAlign: "center", maxWidth: 420 },
});
