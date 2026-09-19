import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  useFonts,
  GrenzeGotisch_600SemiBold,
  GrenzeGotisch_700Bold,
} from "@expo-google-fonts/grenze-gotisch";
import {
  Spectral_400Regular,
  Spectral_500Medium,
  Spectral_600SemiBold,
} from "@expo-google-fonts/spectral";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./src/supabase";
import { AuthScreen } from "./src/screens/AuthScreen";
import { GameRoot } from "./src/screens/GameRoot";
import { CreditsScreen } from "./src/screens/CreditsScreen";
import { fonts, theme } from "./src/theme";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [credits, setCredits] = useState(false);

  // Bundled OFL fonts (Grenze Gotisch + Spectral). `err` lets us proceed on a font failure.
  const [fontsLoaded, fontError] = useFonts({
    GrenzeGotisch_600SemiBold,
    GrenzeGotisch_700Bold,
    Spectral_400Regular,
    Spectral_500Medium,
    Spectral_600SemiBold,
  });

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

  const fontsReady = fontsLoaded || !!fontError;

  const main = !supabaseConfigured ? (
    <View style={styles.center}>
      <Text style={styles.title}>House of Ghouls</Text>
      <Text style={styles.msg}>
        Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in client/.env
        (copy from client/.env.example), then restart.
      </Text>
    </View>
  ) : !ready || !fontsReady ? (
    <View style={styles.center}>
      <ActivityIndicator color={theme.accent} />
    </View>
  ) : !session ? (
    <AuthScreen onCredits={() => setCredits(true)} />
  ) : (
    <GameRoot
      token={session.access_token}
      onSignOut={() => void supabase.auth.signOut()}
      onCredits={() => setCredits(true)}
    />
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {main}
      {/* Credits floats over the live game so opening it never drops the WebSocket session. */}
      {credits && (
        <View style={StyleSheet.absoluteFill}>
          <CreditsScreen onBack={() => setCredits(false)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { color: theme.gold, fontSize: 26, fontWeight: "800", fontFamily: fonts.display },
  msg: { color: theme.dim, textAlign: "center", maxWidth: 420, fontFamily: fonts.body },
});
