import React, { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet, ActivityIndicator, Alert, Clipboard, FlatList, Linking, Share, Modal, NativeEventEmitter, NativeModules, ScrollView, Switch, Text, TextInput,
  TouchableOpacity, UIManager, View, requireNativeComponent, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { pick, types } from '@react-native-documents/picker';
import { useTheme } from '../theme';
import { useEmergencyColors, useOffGrid } from '../atlasTools/offGrid';
import {
  useMaps, useMapDownloads, browseMaps, downloadMap, cancelMapDownload, installedMaps, deleteMap, watchPosition,
  distanceM, bearingDeg, compassName, fmtDistance, fmtCoord, RemoteEntry, LocalMap, GpsFix,
} from '../atlasMaps/maps';
const BACKGROUNDCOLOR_2A0000 = '#2A0000';
const COLOR_FFF = '#fff';
const BACKGROUNDCOLOR_1A0000 = '#1a0000';
const BACKGROUNDCOLOR_E5E7EB = '#E5E7EB';
const BACKGROUNDCOLOR_RGBA_120_0_0_0_45 = 'rgba(120,0,0,0.45)';
const BACKGROUNDCOLOR_RGBA_0_0_0_0_5 = 'rgba(0,0,0,0.5)';
const BORDERWIDTH_2 = 2;
const BORDERWIDTH_0 = 0;
const COLOR_DC2626 = '#DC2626';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  s2: { padding: 6 },
  s3: { color: COLOR_FFF, fontSize: 21, fontWeight: '800', marginLeft: 8, flex: 1 },
  s4: { flexDirection: 'row', alignItems: 'center', padding: 6 },
  s5: { color: COLOR_FFF, marginLeft: 6, fontWeight: '600' },
  s6: { borderRadius: 12, padding: 12, marginBottom: 10 },
  s7: { flexDirection: 'row', alignItems: 'center' },
  s8: { fontWeight: '700', marginLeft: 8, flex: 1 },
  s9: { fontSize: 18, fontWeight: '600', marginTop: 6 },
  s10: { fontSize: 13, marginTop: 2 },
  s11: { flexDirection: 'row', marginTop: 10 },
  s12: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  s13: { borderRadius: 8, paddingVertical: 8, marginRight: 8 },
  s14: { marginLeft: 6, fontWeight: '600' },
  s15: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  s16: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  s17: { marginLeft: 6 },
  s18: { fontSize: 11, marginTop: 4 },
  s19: { marginTop: 6 },
  s20: { borderRadius: 12, padding: 12 },
  s21: { fontWeight: '700', marginBottom: 6 },
  s22: { fontSize: 13 },
  s23: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1 },
  s24: { flex: 1, marginLeft: 10 },
  s25: { fontSize: 16, fontWeight: '600' },
  s26: { fontSize: 12 },
  s27: { alignItems: 'flex-end' },
  s28: { fontWeight: '700' },
  s29: { fontSize: 12, marginLeft: 2 },
  s30: { fontSize: 11, marginTop: 6 },
  s31: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  s32: { flex: 1 },
  s33: { borderRadius: 10, padding: 12, alignItems: 'center' },
  s34: { fontSize: 12, marginTop: 2 },
  s35: { flex: 1, minHeight: 280 },
  s36: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  s37: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: BACKGROUNDCOLOR_RGBA_120_0_0_0_45 },
  s38: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  s39: { fontSize: 17, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  s40: { textAlign: 'center', marginTop: 6 },
  s41: { marginTop: 14 },
  s42: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  s43: { color: COLOR_FFF, fontWeight: '700' },
  s44: { flex: 1, flexDirection: 'row' },
  s45: { width: 380, flexGrow: 0 },
  s46: { padding: 12 },
  s47: { maxHeight: '45%', flexGrow: 0 },
  s48: { padding: 10 },
  s49: { flex: 1, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_5, justifyContent: 'center', padding: 24 },
  s50: { borderRadius: 14, padding: 16, maxWidth: 520, width: '100%', alignSelf: 'center' },
  s51: { fontSize: 17, fontWeight: '700' },
  s52: { fontSize: 12, marginTop: 4 },
  s53: { borderRadius: 8, padding: 12, marginTop: 10 },
  s54: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 16 },
  s55: { fontSize: 16 },
  s56: { fontSize: 16, fontWeight: '700' },
  s57: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  s58: { fontSize: 19, fontWeight: '700', marginLeft: 8, flex: 1 },
  s59: { padding: 14, maxWidth: 820, width: '100%', alignSelf: 'center' },
  s60: { borderRadius: 10, padding: 12, marginBottom: 8 },
  s61: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  s62: { padding: 8 },
  s63: { marginBottom: 12 },
  s64: { color: COLOR_DC2626, marginTop: 4 },
  s65: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 6 },
  s66: { color: COLOR_FFF, fontWeight: '700', fontSize: 16 },
  s67: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8, borderWidth: 1 },
  s68: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  s69: { fontSize: 12, marginTop: 14 },
  s70: { marginTop: 40 },
  s71: { padding: 20 },
  s72: { borderRadius: 10, padding: 14, marginBottom: 6 },
  s73: { fontSize: 16, marginLeft: 10, flex: 1, textTransform: 'capitalize' },
});


const hasNativeMap = !!(UIManager as any).hasViewManagerConfig?.('AtlasMapView') || !!(UIManager as any).getViewManagerConfig?.('AtlasMapView');
const AtlasMapView: any = hasNativeMap ? requireNativeComponent('AtlasMapView') : null;

/** A message telling someone exactly where you are (works by SMS with no internet). */
function locationText(h: { lat: number; lon: number; accuracy: number }, imperial: boolean): string {
  const acc = h.accuracy > 0 ? ` (within about ${imperial ? `${Math.round(h.accuracy * 3.28084)} ft` : `${Math.round(h.accuracy)} m`})` : '';
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `My location at ${time}: ${h.lat.toFixed(5)}, ${h.lon.toFixed(5)}${acc}. Map: https://maps.google.com/?q=${h.lat.toFixed(5)},${h.lon.toFixed(5)}`;
}

/** Offline maps + GPS + saved places. Part of emergency / travel use: no internet needed once a map is downloaded. */
export const MapsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors: base } = useTheme();
  const colors = useEmergencyColors(base);
  const night = useOffGrid((s) => s.nightRed);
  const accent = night ? '#B91C1C' : '#0F766E';
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const current = useMaps((s) => s.current);
  const waypoints = useMaps((s) => s.waypoints);
  const imperial = useMaps((s) => s.imperial);
  const addWaypoint = useMaps((s) => s.addWaypoint);
  const removeWaypoint = useMaps((s) => s.removeWaypoint);
  const renameWaypoint = useMaps((s) => s.renameWaypoint);
  const lastFix = useMaps((s) => s.lastFix);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number; zoom?: number; nonce: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number; zoom: number } | null>(null);
  const [manager, setManager] = useState(false);
  const [follow, setFollow] = useState(false);
  const [naming, setNaming] = useState<{ id?: string; lat: number; lon: number; name: string } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // GPS on while this screen is open.
  useEffect(() => {
    let stop: () => void = () => undefined;
    let alive = true;
    watchPosition((f) => { if (alive) { setFix(f); setGpsMsg(null); } }, (m) => alive && setGpsMsg(m))
      .then((s) => { if (alive) stop = s; else s(); })
      .catch((e) => alive && setGpsMsg(String(e?.message || e)));
    return () => { alive = false; stop(); };
  }, []);
  useEffect(() => {
    if (!AtlasMapView) return;
    const em = new NativeEventEmitter(NativeModules.AtlasDevice);
    const a = em.addListener('AtlasMapCenter', (c: any) => setMapCenter(c));
    const b = em.addListener('AtlasMapError', (e: any) => setMapError(String(e?.message || 'Could not open this map file')));
    return () => { a.remove(); b.remove(); };
  }, []);
  useEffect(() => { setMapError(null); }, [current]);
  useEffect(() => { if (follow && fix) setCenter({ lat: fix.lat, lon: fix.lon, nonce: Date.now() }); }, [fix, follow]);

  const here = fix || lastFix;
  const goTo = (lat: number, lon: number, zoom?: number) => { setFollow(false); setCenter({ lat, lon, zoom, nonce: Date.now() }); };
  const centerMe = () => {
    if (!here) { Alert.alert('No GPS fix yet', gpsMsg || 'Waiting for GPS. Outdoors with a view of the sky works best (it can take a minute the first time).'); return; }
    setFollow(true);
    setCenter({ lat: here.lat, lon: here.lon, zoom: Math.max(mapCenter?.zoom || 0, 15), nonce: Date.now() });
  };
  const markers = useMemo(() => waypoints.map((w) => ({ lat: w.lat, lon: w.lon, color: night ? 0xffff3b3b | 0 : 0xffdc2626 | 0 })), [waypoints, night]);
  const me = here ? { lat: here.lat, lon: here.lon } : null;

  const savePlace = () => {
    if (!naming) return;
    const name = naming.name.trim() || `Place ${waypoints.length + 1}`;
    if (naming.id) renameWaypoint(naming.id, name); else addWaypoint({ name, lat: naming.lat, lon: naming.lon });
    setNaming(null);
  };

  const header = (
    <View style={[literalStyles.s1, { backgroundColor: night ? BACKGROUNDCOLOR_2A0000 : accent }]}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s2}><Icon name="arrow-left" size={22} color="#fff" /></TouchableOpacity>
      <Text style={literalStyles.s3}>Maps</Text>
      <TouchableOpacity onPress={() => setManager(true)} style={literalStyles.s4}>
        <Icon name="layers" size={20} color="#fff" /><Text style={literalStyles.s5}>Maps on phone</Text>
      </TouchableOpacity>
    </View>
  );

  const gpsCard = (
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s6]}>
      <View style={literalStyles.s7}>
        <Icon name="crosshair" size={18} color={accent} />
        <Text style={[{ color: colors.text }, literalStyles.s8]}>Your position</Text>
        {!!here && (
          <TouchableOpacity onPress={() => { Clipboard.setString(`${here.lat.toFixed(6)}, ${here.lon.toFixed(6)}`); Alert.alert('Copied', 'Coordinates copied. Paste them in a text to tell someone where you are.'); }}>
            <Icon name="copy" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      {here ? (
        <>
          <Text selectable style={[{ color: colors.text }, literalStyles.s9]}>{fmtCoord(here.lat, here.lon)}</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s10]}>
            {fix ? `Accuracy ±${fmtDistance(here.accuracy, imperial)}` : 'Last known position (waiting for a new fix)'}
            {here.altitude > -99999 ? ` · Altitude ${imperial ? `${Math.round(here.altitude * 3.28084)} ft` : `${Math.round(here.altitude)} m`}` : ''}
            {here.speed > 0.5 ? ` · ${imperial ? `${(here.speed * 2.23694).toFixed(0)} mph` : `${(here.speed * 3.6).toFixed(0)} km/h`}` : ''}
          </Text>
          <View style={literalStyles.s11}>
            <TouchableOpacity onPress={() => Linking.openURL(`sms:?body=${encodeURIComponent(locationText(here, imperial))}`).catch(() => Alert.alert('No texting app found'))}
              style={[literalStyles.s12, { borderColor: accent }, literalStyles.s13]}>
              <Icon name="message-square" size={15} color={accent} /><Text style={[{ color: accent }, literalStyles.s14]}>Text my location</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Share.share({ message: locationText(here, imperial) }).catch(() => undefined)}
              style={[literalStyles.s15, { borderColor: colors.border }, literalStyles.s16]}>
              <Icon name="share-2" size={15} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }, literalStyles.s17]}>Share</Text>
            </TouchableOpacity>
          </View>
          <Text style={[{ color: colors.textMuted }, literalStyles.s18]}>A text message only needs a phone signal, not internet.</Text>
        </>
      ) : (
        <Text style={[{ color: colors.textSecondary }, literalStyles.s19]}>{gpsMsg || 'Finding GPS... works with no internet or signal. Outdoors is fastest.'}</Text>
      )}
    </View>
  );

  const placesList = (
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s20]}>
      <Text style={[{ color: colors.text }, literalStyles.s21]}>Saved places</Text>
      {!waypoints.length && <Text style={[{ color: colors.textSecondary }, literalStyles.s22]}>Save your camp, car, water source or shelter. Move the map so the + is on the spot and tap "Save spot", or tap "Save my position".</Text>}
      {waypoints.map((w) => {
        const d = here ? distanceM(here, w) : null;
        const b = here ? bearingDeg(here, w) : null;
        return (
          <TouchableOpacity key={w.id} onPress={() => goTo(w.lat, w.lon, Math.max(mapCenter?.zoom || 0, 15))}
            onLongPress={() => Alert.alert(w.name, fmtCoord(w.lat, w.lon), [
              { text: 'Rename', onPress: () => setNaming({ id: w.id, lat: w.lat, lon: w.lon, name: w.name }) },
              { text: 'Copy coordinates', onPress: () => Clipboard.setString(`${w.lat.toFixed(6)}, ${w.lon.toFixed(6)}`) },
              { text: 'Delete', style: 'destructive', onPress: () => removeWaypoint(w.id) },
              { text: 'Cancel', style: 'cancel' },
            ])}
            style={[literalStyles.s23, { borderTopColor: colors.border }]}>
            <Icon name="map-pin" size={18} color={night ? '#FF3B3B' : '#DC2626'} />
            <View style={literalStyles.s24}>
              <Text style={[{ color: colors.text }, literalStyles.s25]}>{w.name}</Text>
              <Text style={[{ color: colors.textMuted }, literalStyles.s26]}>{fmtCoord(w.lat, w.lon)}</Text>
            </View>
            {d !== null && b !== null && (
              <View style={literalStyles.s27}>
                <Text style={[{ color: colors.text }, literalStyles.s28]}>{fmtDistance(d, imperial)}</Text>
                <View style={literalStyles.s7}>
                  <View style={{ transform: [{ rotate: `${b}deg` }] }}><Icon name="arrow-up" size={14} color={colors.textSecondary} /></View>
                  <Text style={[{ color: colors.textSecondary }, literalStyles.s29]}>{compassName(b)} {Math.round(b)}°</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
      {waypoints.length > 0 && <Text style={[{ color: colors.textMuted }, literalStyles.s30]}>Tap to show on the map. Hold for rename / copy / delete. Direction is from true north - use the Compass screen (or the sun) to face it.</Text>}
    </View>
  );

  const actions = (
    <View style={literalStyles.s31}>
      <TouchableOpacity onPress={centerMe} style={[literalStyles.s32, { backgroundColor: follow ? accent : colors.surface }, literalStyles.s33]}>
        <Icon name="navigation" size={18} color={follow ? '#fff' : colors.text} />
        <Text style={[{ color: follow ? COLOR_FFF : colors.text }, literalStyles.s34]}>Center on me</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => mapCenter ? setNaming({ lat: mapCenter.lat, lon: mapCenter.lon, name: '' }) : Alert.alert('Open a map first')} style={[literalStyles.s32, { backgroundColor: colors.surface }, literalStyles.s33]}>
        <Icon name="plus-circle" size={18} color={colors.text} />
        <Text style={[{ color: colors.text }, literalStyles.s34]}>Save spot (+)</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => here ? setNaming({ lat: here.lat, lon: here.lon, name: '' }) : Alert.alert('No GPS fix yet')} style={[literalStyles.s32, { backgroundColor: colors.surface }, literalStyles.s33]}>
        <Icon name="map-pin" size={18} color={colors.text} />
        <Text style={[{ color: colors.text }, literalStyles.s34]}>Save my position</Text>
      </TouchableOpacity>
    </View>
  );

  const mapArea = (
    <View style={[literalStyles.s35, { backgroundColor: night ? BACKGROUNDCOLOR_1A0000 : BACKGROUNDCOLOR_E5E7EB }]}>
      {AtlasMapView && current && !mapError ? (
        <>
          <AtlasMapView style={literalStyles.s32} mapPath={current} center={center} markers={markers} me={me} />
          <View pointerEvents="none" style={literalStyles.s36}>
            <Icon name="plus" size={28} color={night ? '#FF3B3B' : '#111'} />
          </View>
          {night && <View pointerEvents="none" style={literalStyles.s37} />}
        </>
      ) : (
        <View style={literalStyles.s38}>
          <Icon name="map" size={42} color={colors.textMuted} />
          <Text style={[{ color: colors.text }, literalStyles.s39]}>
            {!AtlasMapView ? 'Maps need the newest app build.' : mapError ? 'This map file could not be opened' : 'No map yet'}
          </Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s40]}>
            {mapError || 'Download the map for your state or country while you have internet (Wi-Fi recommended). After that it works with no internet at all. GPS, coordinates and saved places work even without a map.'}
          </Text>
          {!!AtlasMapView && (
            <TouchableOpacity onPress={() => setManager(true)} style={[literalStyles.s41, { backgroundColor: accent }, literalStyles.s42]}>
              <Text style={literalStyles.s43}>Get a map</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={[literalStyles.s32, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {header}
      {wide ? (
        <View style={literalStyles.s44}>
          {mapArea}
          <ScrollView style={literalStyles.s45} contentContainerStyle={literalStyles.s46}>
            {gpsCard}{actions}{placesList}
          </ScrollView>
        </View>
      ) : (
        <>
          {mapArea}
          <ScrollView style={literalStyles.s47} contentContainerStyle={literalStyles.s48}>
            {gpsCard}{actions}{placesList}
          </ScrollView>
        </>
      )}

      <Modal visible={!!naming} transparent animationType="fade" onRequestClose={() => setNaming(null)}>
        <View style={literalStyles.s49}>
          <View style={[{ backgroundColor: colors.surface }, literalStyles.s50]}>
            <Text style={[{ color: colors.text }, literalStyles.s51]}>{naming?.id ? 'Rename place' : 'Save this place'}</Text>
            {!!naming && <Text style={[{ color: colors.textMuted }, literalStyles.s52]}>{fmtCoord(naming.lat, naming.lon)}</Text>}
            <TextInput autoFocus value={naming?.name || ''} onChangeText={(t) => setNaming((n) => (n ? { ...n, name: t } : n))} onSubmitEditing={savePlace}
              placeholder="e.g. Camp, Car, Spring, Shelter" placeholderTextColor={colors.textMuted}
              style={[{ backgroundColor: colors.background, color: colors.text }, literalStyles.s53]} />
            <View style={literalStyles.s54}>
              <TouchableOpacity onPress={() => setNaming(null)}><Text style={[{ color: colors.textSecondary }, literalStyles.s55]}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={savePlace}><Text style={[{ color: accent }, literalStyles.s56]}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <MapManager visible={manager} onClose={() => setManager(false)} colors={colors} accent={accent} />
    </SafeAreaView>
  );
};

/** Download, switch and delete offline maps. */
const MapManager: React.FC<{ visible: boolean; onClose: () => void; colors: any; accent: string }> = ({ visible, onClose, colors, accent }) => {
  const current = useMaps((s) => s.current);
  const setCurrent = useMaps((s) => s.setCurrent);
  const external = useMaps((s) => s.external);
  const addExternal = useMaps((s) => s.addExternal);
  const removeExternal = useMaps((s) => s.removeExternal);
  const imperial = useMaps((s) => s.imperial);
  const setImperial = useMaps((s) => s.setImperial);
  const progress = useMapDownloads((s) => s.progress);
  const [local, setLocal] = useState<LocalMap[]>([]);
  const [path, setPath] = useState<string | null>(null); // null = installed list, '' = server root
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => installedMaps().then(setLocal).catch(() => setLocal([]));
  useEffect(() => { if (visible) { void refresh(); setPath(null); } }, [visible]);
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    setLoading(true); setErr(null);
    void browseMaps(path).then((e) => { if (alive) setEntries(e); }).catch((e) => { if (alive) setErr(String(e?.message || e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path]);

  const get = async (e: RemoteEntry) => {
    try { const p = await downloadMap(e.path); await refresh(); setCurrent(p); Alert.alert('Map ready', `${e.name} is on your phone and works offline.`); }
    catch (x: any) { if (!/cancel|abort/i.test(String(x?.message))) Alert.alert('Download failed', String(x?.message || x)); }
  };
  const openFile = async () => {
    try {
      const res = await pick({ mode: 'open', requestLongTermAccess: true, type: [types.allFiles], allowMultiSelection: false });
      const f = res?.[0];
      if (!f) return;
      if (!/\.map$/i.test(f.name || '')) { Alert.alert('Not a map file', 'Pick a Mapsforge ".map" file (for example from download.mapsforge.org or openandromaps.org).'); return; }
      addExternal(f.uri, (f.name || 'map').replace(/\.map$/i, ''));
      setCurrent(f.uri);
    } catch { /* cancelled */ }
  };
  const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
  const downloading = Object.keys(progress);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (path === null ? onClose() : setPath(path ? path.replace(/[^/]+\/$/, '') : null))}>
      <SafeAreaView style={[literalStyles.s32, { backgroundColor: colors.background }]}>
        <View style={[literalStyles.s57, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => (path === null ? onClose() : setPath(path ? path.replace(/[^/]+\/$/, '') : null))} style={literalStyles.s2}>
            <Icon name={path === null ? 'x' : 'arrow-left'} size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[{ color: colors.text }, literalStyles.s58]} numberOfLines={1}>
            {path === null ? 'Maps on this phone' : path ? path.replace(/\/$/, '').split('/').pop()!.replace(/[-_]/g, ' ') : 'Download a map'}
          </Text>
        </View>
        {path === null ? (
          <ScrollView contentContainerStyle={literalStyles.s59}>
            {local.map((m) => (
              <View key={m.path} style={[literalStyles.s7, { backgroundColor: colors.surface }, literalStyles.s60, { borderWidth: current === m.path ? BORDERWIDTH_2 : BORDERWIDTH_0, borderColor: accent }]}>
                <TouchableOpacity style={literalStyles.s32} onPress={() => { setCurrent(m.path); onClose(); }}>
                  <Text style={[{ color: colors.text }, literalStyles.s61]}>{m.name}</Text>
                  <Text style={[{ color: colors.textMuted }, literalStyles.s26]}>{mb(m.size)}{current === m.path ? ' · in use' : ' · tap to use'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert('Delete map?', m.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { deleteMap(m.path).then(refresh).catch(() => undefined); } }])} style={literalStyles.s62}>
                  <Icon name="trash-2" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
            {external.map((m) => (
              <View key={m.uri} style={[literalStyles.s7, { backgroundColor: colors.surface }, literalStyles.s60, { borderWidth: current === m.uri ? BORDERWIDTH_2 : BORDERWIDTH_0, borderColor: accent }]}>
                <TouchableOpacity style={literalStyles.s32} onPress={() => { setCurrent(m.uri); onClose(); }}>
                  <Text style={[{ color: colors.text }, literalStyles.s25]}>{m.name}</Text>
                  <Text style={[{ color: colors.textMuted }, literalStyles.s26]}>From your files{current === m.uri ? ' · in use' : ' · tap to use'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeExternal(m.uri)} style={literalStyles.s62}><Icon name="x" size={18} color={colors.textSecondary} /></TouchableOpacity>
              </View>
            ))}
            {!local.length && !external.length && <Text style={[{ color: colors.textSecondary }, literalStyles.s63]}>No maps yet. A US state is usually 50-400 MB, a small country 50-800 MB.</Text>}
            {downloading.map((k) => (
              <View key={k} style={[{ backgroundColor: colors.surface }, literalStyles.s60]}>
                <Text style={{ color: colors.text }}>Downloading {k.split('/').pop()!.replace('.map', '').replace(/[-_]/g, ' ')}: {Math.round((progress[k] || 0) * 100)}%</Text>
                <TouchableOpacity onPress={() => cancelMapDownload(k)}><Text style={literalStyles.s64}>Cancel</Text></TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => setPath('')} style={[{ backgroundColor: accent }, literalStyles.s65]}>
              <Text style={literalStyles.s66}>Download a map (needs internet)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openFile} style={[literalStyles.s67, { borderColor: colors.border }]}>
              <Text style={{ color: colors.text }}>Open a .map file already on the phone</Text>
            </TouchableOpacity>
            <View style={literalStyles.s68}>
              <Text style={[{ color: colors.text }, literalStyles.s32]}>Miles and feet (off = km and meters)</Text>
              <Switch value={imperial} onValueChange={setImperial} />
            </View>
            <Text style={[{ color: colors.textMuted }, literalStyles.s69]}>Maps are OpenStreetMap data (© OpenStreetMap contributors) from the Mapsforge project, drawn on your phone. Roads, trails, rivers, towns and buildings - no satellite photos.</Text>
          </ScrollView>
        ) : loading ? (
          <ActivityIndicator style={literalStyles.s70} color={accent} />
        ) : err ? (
          <Text style={[{ color: colors.textSecondary }, literalStyles.s71]}>{err}</Text>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => e.path}
            contentContainerStyle={literalStyles.s59}
            renderItem={({ item: e }) => {
              const p = progress[e.path];
              return (
                <TouchableOpacity onPress={() => (e.isDir ? setPath(e.path) : p === undefined && get(e))}
                  style={[literalStyles.s7, { backgroundColor: colors.surface }, literalStyles.s72]}>
                  <Icon name={e.isDir ? 'folder' : 'download'} size={18} color={e.isDir ? colors.textSecondary : accent} />
                  <Text style={[{ color: colors.text }, literalStyles.s73]}>{e.name}</Text>
                  {p !== undefined ? <Text style={{ color: accent }}>{Math.round(p * 100)}%</Text> : <Text style={{ color: colors.textMuted }}>{e.size}</Text>}
                  {e.isDir && <Icon name="chevron-right" size={18} color={colors.textMuted} />}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};
