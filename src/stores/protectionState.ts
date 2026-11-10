/**
 * Session state of protected (PIN-locked) projects: which are open right now and with which PIN.
 * A leaf on purpose - the chat, project and document-index modules all ask "is this project open?",
 * so this state must not import any of them. The PINs live only in memory and die with the process.
 */
const pins = new Map<string, string>();

/** True while a protected project is open (its PIN is in memory this session). */
export const isProtectedProjectUnlocked = (id: string): boolean => pins.has(id);
export const isProtectedProjectOpen = isProtectedProjectUnlocked;

/** The PIN of an unlocked project, kept in memory only. For the document vault. */
export const unlockedProjectPin = (id: string): string | undefined => pins.get(id);

/** The ids of every project open right now. */
export const unlockedProjectIds = (): string[] => [...pins.keys()];

/** Each open project with its PIN, for sealing them all (backup, re-lock). */
export const unlockedProjectEntries = (): Array<[string, string]> => [...pins.entries()];

// Mutators for protectedProjectStorage (the lock/unlock orchestrator) only.
export const rememberProjectPin = (id: string, pin: string): void => { pins.set(id, pin); };
export const forgetProjectPin = (id: string): void => { pins.delete(id); };
export const forgetAllProjectPins = (): void => { pins.clear(); };
