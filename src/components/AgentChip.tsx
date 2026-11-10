import React, { useState } from 'react';
import { Modal, Text, TouchableOpacity, View, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useAgentStore } from '../stores/agentStore';
const BACKGROUNDCOLOR_RGBA_0_0_0_0_45 = 'rgba(0,0,0,0.45)';
const literalStyles = StyleSheet.create({
  s1: { fontSize: 15 },
  s2: { fontSize: 12 },
});


/** Chat header: shows the active agent; tap to switch agents (or none). */
export function AgentChip({ styles, colors, onSelect }: { styles: any; colors: any; onSelect?: (agentId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const agents = useAgentStore((s) => s.agents);
  const activeId = useAgentStore((s) => s.activeAgentId);
  const setActive = useAgentStore((s) => s.setActiveAgent);
  const active = agents.find((a) => a.id === activeId);
  const pick = (id: string | null) => { setActive(id); onSelect?.(id); setOpen(false); };
  return (
    <>
      <TouchableOpacity style={styles.headerProjectRow} onPress={() => setOpen(true)} testID="agent-selector">
        <Icon name="user" size={11} color={active ? colors.primary : colors.textMuted} />
        <Text style={[styles.headerSubtitle, { color: active ? colors.primary : colors.textMuted }]} numberOfLines={1}>
          {active ? active.name : 'No agent'}
        </Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={local.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[local.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[local.title, { color: colors.text }]}>Choose agent</Text>
            <ScrollView style={local.list}>
              {[{ id: null as string | null, name: 'No agent', description: 'Use the project or default instructions' }, ...agents].map((a) => {
                const on = a.id === activeId;
                return (
                  <TouchableOpacity key={a.id ?? 'none'} style={local.row} onPress={() => pick(a.id)}>
                    <Icon name={on ? 'check-circle' : 'circle'} size={18} color={on ? colors.primary : colors.textMuted} />
                    <View style={local.rowText}>
                      <Text style={[{ color: colors.text }, literalStyles.s1]}>{a.name}</Text>
                      {!!a.description && <Text style={[{ color: colors.textSecondary }, literalStyles.s2]} numberOfLines={1}>{a.description}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={[local.hint, { color: colors.textMuted }]}>Create and edit agents in the Agents tab.</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const local = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_45, justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 12, padding: 16, maxHeight: '70%', width: '100%', maxWidth: 520, alignSelf: 'center' },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowText: { marginLeft: 12, flex: 1 },
  hint: { fontSize: 12, marginTop: 8 },
});
