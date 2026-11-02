/**
 * Runs scheduled tasks. Atlas has no background alarm of its own, so tasks run while Atlas is open: when it comes to the
 * front and once a minute after that, the due ones run (a task that was due while the phone was away runs once, on
 * return). A prompt task asks the AI and keeps the answer as a new chat; the briefing task makes today's briefing.
 */
import { AppState } from 'react-native';
import { useSchedule, type ScheduledTask } from './store';
import { isDue } from './due';
import { startAlarmSync, syncAlarms } from './alarms';

const RETRY_AFTER_MS = 15 * 60_000;
let busy = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
export const isRunning = () => busy;
export const onRunningChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function whatToAsk(task: ScheduledTask): { system: string; user: string } {
  const { useSkills } = require('../skills/skillsStore');
  const { skillsNote } = require('../skills/selectSkills');
  const { llmService } = require('../services/llm');
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const ctx = Number(llmService.getPerformanceSettings?.()?.contextLength) || 4096;
  const skills = skillsNote(task.prompt, useSkills.getState().skills, ctx);
  return {
    system: `You are Atlas, running a scheduled task for the user on their phone. Today is ${today}. Do the task directly and give the result, with no preamble.${skills}`,
    user: task.prompt,
  };
}

async function keepAsChat(task: ScheduledTask, answer: string): Promise<string> {
  const { useChatStore, useAppStore } = require('../stores');
  const app = useAppStore.getState();
  const modelId = app.activeModelId ?? app.loadedTextModelId ?? app.downloadedModels[0]?.id ?? '';
  const title = `${task.name} - ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const chat = useChatStore.getState();
  const id = chat.createConversation(modelId, title);
  chat.addMessage(id, { role: 'user', content: task.prompt });
  chat.addMessage(id, { role: 'assistant', content: answer });
  return id;
}

async function doTask(task: ScheduledTask): Promise<{ chatId?: string }> {
  if (task.kind === 'briefing') {
    const { makeBriefing, todaysBrief } = require('../atlasTools/dailyBrief');
    if (todaysBrief()) return {};
    const { listVoices } = require('../atlasVoice/tts');
    const voices: unknown[] = await listVoices('en').catch(() => []);
    await makeBriefing(() => undefined, voices.length);
    return {};
  }
  const { askModel } = require('../study/engine');
  const { system, user } = whatToAsk(task);
  const answer: string = await askModel(system, user);
  if (!answer.trim()) throw new Error('The AI gave an empty answer.');
  return { chatId: await keepAsChat(task, answer.trim()) };
}

/** Runs one task now (also "Run now"). Records the result or the error on the task. Returns an error message or null. */
export async function runTask(id: string, scheduledFor = Date.now()): Promise<string | null> {
  const { tasks, update } = useSchedule.getState();
  const task = tasks.find((t) => t.id === id);
  if (!task || busy) return busy ? 'Another scheduled task is running.' : 'Task not found.';
  busy = true; emit();
  update(id, { lastTriedAt: scheduledFor });
  try {
    const { chatId } = await doTask(task);
    update(id, {
      lastRunAt: scheduledFor, lastError: undefined,
      ...(chatId ? { lastChatId: chatId, resultSeen: false } : {}),
      ...(task.repeat === 'once' ? { enabled: false } : {}),
    });
    return null;
  } catch (e: any) {
    const message = String(e?.message || e);
    update(id, { lastError: message });
    return message;
  } finally { busy = false; emit(); }
}

/** Runs every task that is due, one after another. A task that failed is tried again after a while, not at once. */
export async function runDueTasks(now = Date.now()): Promise<void> {
  if (busy) return;
  const due = useSchedule.getState().tasks.filter((t) => isDue(t, now) && (t.lastTriedAt ?? 0) < now - RETRY_AFTER_MS);
  for (const task of due) await runTask(task.id, now);
}

/** Starts checking for due tasks while Atlas is open. Returns the stop function. */
export function startScheduler(): () => void {
  const check = () => { if (AppState.currentState === 'active') void runDueTasks(); };
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
  const timer = setInterval(check, 60_000);
  const first = setTimeout(check, 5_000);
  const alarms = startAlarmSync();
  // Coming back to the front tops the alarms up, so the notifications keep coming for two more weeks.
  const topUp = AppState.addEventListener('change', (s) => { if (s === 'active') void syncAlarms(); });
  return () => { sub.remove(); topUp.remove(); alarms(); clearInterval(timer); clearTimeout(first); };
}
