import RNFS from 'react-native-fs';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore, waitForChatPersistence } from '../stores/chatStore';
import { ragService } from './rag';
import { demoRolloutPdfBase64 } from './demoSeedPdf';
import type { MediaAttachment, Message } from '../types';

const commitments =
  'You made three commitments to Sam: send the pilot scope for 40 seats, starting on 14 November; confirm the owners and checks, with Priya owning the rollout and Tom verifying the gateway policy; and arrange a kickoff call next Tuesday.';
const scenes = [
  {
    title: 'What did I promise Sam?',
    prompt: 'What did I promise Sam?',
    answer:
      'You made three commitments to Sam:\n\n1. Send the pilot scope for 40 seats, starting on 14 November.\n2. Confirm the owners and checks: Priya owns the rollout, and Tom verifies the gateway policy.\n3. Arrange a kickoff call next Tuesday.',
  },
  {
    title: 'Acme pilot owners and kickoff',
    prompt:
      'Who owns the rollout, who checks the gateway policy, and when does the pilot start?',
    answer:
      'Priya Nair owns the rollout plan. Tom Reyes verifies the gateway policy before kickoff. The Acme Corp pilot starts on 14 November with 40 seats.',
  },
  {
    title: 'Reply to Sam',
    prompt:
      'Draft a short reply to Sam confirming the pilot scope and next steps.',
    answer:
      'Hi Sam,\n\nThe Acme Corp pilot starts on 14 November with 40 seats. Priya owns the rollout plan, and Tom will verify the gateway policy before kickoff. I will send the rollout plan on Friday at 10 AM. Let us confirm the kickoff call for next Tuesday.\n\nAlex',
  },
  {
    title: 'Translate the pilot email',
    prompt: 'Translate my pilot update into Spanish. Keep the names unchanged.',
    answer:
      'Hola Sam:\n\nEl piloto de Acme Corp comienza el 14 de noviembre con 40 plazas. Priya Nair se encarga del plan de despliegue y Tom Reyes verifica la política de la pasarela antes de la reunión inicial. Te enviaré el plan el viernes a las 10:00. Confirmemos la reunión inicial para el próximo martes.\n\nAlex',
  },
  {
    title: 'Pilot readiness checklist',
    prompt: 'Give me a short checklist for the Acme pilot.',
    answer:
      '1. Send Sam the scope for 40 seats.\n2. Confirm Priya owns the rollout plan.\n3. Ask Tom to verify the gateway policy.\n4. Send Acme_rollout_v3.pdf on Friday at 10 AM.\n5. Confirm the kickoff call next Tuesday.\n6. Start the pilot on 14 November.',
  },
];

/** Opt-in developer data, written through the same owners as normal app actions. */
export async function seedDemoData(deps: {
  /** The composer's voice-note attachment builder, passed in so this service does not import UI. */
  buildVoiceAttachment: (opts: {
    uri: string;
    format: 'wav' | 'mp3';
    durationSeconds?: number;
    transcription?: string;
  }) => MediaAttachment;
}): Promise<{
  chats: number;
  documents: number;
  warnings: string[];
}> {
  if (!__DEV__)
    throw new Error('Demo seeding is available in developer builds only.');
  if (
    !useChatStore.persist.hasHydrated() ||
    !useProjectStore.persist.hasHydrated()
  ) {
    throw new Error(
      'Wait for the app to finish loading, then load the demo again.',
    );
  }
  const modelId = useAppStore.getState().downloadedModels[0]?.id;
  if (!modelId)
    throw new Error('Download a text model before loading the demo.');
  const projects = useProjectStore.getState();
  const project =
    projects.projects.find(item => item.name === 'Acme Corp pilot') ??
    projects.createProject({
      name: 'Acme Corp pilot',
      description:
        'Alex at Off Grid AI. Synthetic pilot documents and customer conversations.',
      systemPrompt:
        'The user is Alex at Off Grid AI. Use the project documents as your source. Do not invent dates or commitments. Keep replies short.',
    });
  let chats = 0;
  for (const scene of scenes) {
    const store = useChatStore.getState();
    if (
      store.conversations.some(
        item =>
          item.projectId === project.id &&
          item.title === scene.title &&
          item.messages.some(
            message =>
              message.role === 'assistant' && message.content === scene.answer,
          ),
      )
    )
      continue;
    const id = store.createConversation(modelId, scene.title, project.id);
    store.addMessage(id, { role: 'user', content: scene.prompt });
    store.addMessage(id, { role: 'assistant', content: scene.answer });
    chats++;
  }
  // A playable synthetic voice note uses the same attachment contract as a recording.
  const voicePath = `${RNFS.DocumentDirectoryPath}/acme-demo-question.wav`;
  if (await RNFS.exists(voicePath)) {
    const store = useChatStore.getState();
    const title = 'Acme pilot voice notes';
    const existingVoice = store.conversations.find(item => item.projectId === project.id && item.title === title);
    const voiceAnswer = existingVoice?.messages.find(message => message.role === 'assistant' && message.content === scenes[1].answer);
    if (existingVoice && voiceAnswer) {
      // Reloading this opt-in fixture restores its two-message capture scene.
      store.deleteMessagesAfter(existingVoice.id, voiceAnswer.id);
    }
    if (!existingVoice) {
      const scene = scenes[1];
      const id = store.createConversation(modelId, title, project.id);
      const { buildVoiceAttachment } = deps;
      store.addMessage(id, {
        role: 'user',
        content: scene.prompt,
        attachments: [buildVoiceAttachment({
          uri: voicePath,
          format: 'wav',
          durationSeconds: 4.86,
          transcription: scene.prompt,
        })],
      });
      store.addMessage(id, { role: 'assistant', content: scene.answer });
      chats++;
    }
  }
  // Screenshot fixtures are normal saved messages, including the same portable
  // work records that a paired device supplies. No model request is dispatched.
  const receiptPath = `${RNFS.DocumentDirectoryPath}/acme-demo-receipt.png`;
  const receiptAvailable = await RNFS.exists(receiptPath);
  const captureScenes: Array<{
    key: string;
    title: string;
    prompt: string;
    reply?: Omit<Message, 'id' | 'timestamp'>;
    receipt?: boolean;
  }> = [
    {
      key: '000000000001', title: 'Pilot date reply',
      prompt: 'Draft a reply to Sam about the pilot date',
      reply: { role: 'assistant', isStreaming: true, turnStatus: 'running',
        content: 'Hi Sam,\n\nThe Acme Corp pilot starts on 14 November with 40 seats. Priya Nair owns the rollout plan, and Tom Reyes will verify the gateway policy',
        reasoningContent: 'Use the pilot notes. Keep the date, seat count and owners unchanged. Sign the draft Alex.' },
    },
    {
      key: '000000000002', title: 'Pilot seat-days',
      prompt: 'How many seat-days is the pilot?',
      reply: { role: 'assistant', content: '', isStreaming: true, turnStatus: 'running',
        timeline: [{ kind: 'thinking', text: 'The pilot has 40 seats for 30 days. Multiply 40 by 30.' }, { kind: 'tool', toolIndex: 0 }],
        toolArtifacts: [{ id: 'acme-seat-days', name: 'calculator', arguments: '{"expression":"40 * 30"}', result: '', status: 'running' }] },
    },
    {
      key: '000000000003', title: 'Pilot seat-days result',
      prompt: 'How many seat-days is the pilot?',
      reply: { role: 'assistant', content: 'The pilot accounts for **1,200 seat-days**.\n\n40 seats × 30 days = 1,200 seat-days.', turnStatus: 'completed',
        timeline: [{ kind: 'thinking', text: 'The pilot has 40 seats for 30 days. Multiply 40 by 30.' }, { kind: 'tool', toolIndex: 0 }],
        toolArtifacts: [{ id: 'acme-seat-days', name: 'calculator', arguments: '{"expression":"40 * 30"}', result: '1200', status: 'completed', durationMs: 18 }] },
    },
    {
      key: '000000000004', title: 'Receipt total', prompt: "What's the total?", receipt: true,
      reply: { role: 'assistant', content: '', isThinking: true, isStreaming: true, turnStatus: 'running',
        reasoningContent: 'Read the receipt. Check the subtotal and tax, then find the total.' },
    },
    {
      key: '000000000005', title: 'Receipt total result', prompt: "What's the total?", receipt: true,
      reply: { role: 'assistant', content: 'The total is **$18.90**, including $1.40 in tax. The receipt lists two flat whites and one sandwich.', turnStatus: 'completed' },
    },
    {
      key: '000000000006', title: 'Pilot voice input', prompt: 'Remind me when the Acme pilot starts and who owns the rollout.',
      reply: { role: 'assistant', content: 'The Acme Corp pilot starts on **14 November** with **40 seats**. Priya Nair owns the rollout. Tom Reyes verifies the gateway policy before kickoff.', turnStatus: 'completed' },
    },
    {
      key: '000000000007', title: 'Pilot notes offline', prompt: 'Summarize the Acme pilot notes in three points.',
      reply: { role: 'assistant', content: '1. Start on **14 November** with **40 seats**.\n2. **Priya Nair** owns the rollout; **Tom Reyes** verifies the gateway policy.\n3. Send **Sam Okafor** the rollout plan on Friday at 10 AM.', turnStatus: 'completed',
        generationMeta: { modelName: 'Qwen 3.5 0.8B' } },
    },
    {
      key: '000000000008', title: 'Pilot review on Alex’s Mac', prompt: 'Review the Acme pilot plan and list the next actions.',
      reply: { role: 'assistant', content: '**Next actions for the 40-seat pilot**\n\n- Priya Nair: confirm the rollout plan.\n- Tom Reyes: verify the gateway policy.\n- Alex: send Sam Okafor the plan on Friday at 10 AM.\n\nThe pilot starts on **14 November**.', turnStatus: 'completed',
        generationMeta: { modelName: 'Qwen 3.5 9B · Alex’s Mac' } },
    },
    {
      key: '000000000009', title: 'Pilot seat-days question',
      prompt: 'How many seat-days is the pilot?',
    },
    {
      key: '000000000010', title: 'Pilot notes offline question',
      prompt: 'Summarize the Acme pilot notes in three points.',
    },
    {
      key: '000000000011', title: 'Pilot reply awaiting approval',
      prompt: 'Draft a reply to Sam about the pilot date. Ask me before sending.',
      reply: { role: 'assistant', turnStatus: 'completed', content: 'Hi Sam,\n\nThe Acme Corp pilot starts on 14 November with 40 seats. Priya Nair owns the rollout. Tom Reyes verifies the gateway policy before kickoff.\n\nAlex\n\nSend this reply to Sam?' },
    },
  ];
  for (const scene of captureScenes) {
    if (scene.receipt && !receiptAvailable) continue;
    const store = useChatStore.getState();
    const uuid = `a1ec0000-0000-4000-8000-${scene.key}`;
    if (store.conversations.some(item => item.messages.some(message => message.uuid === uuid))) continue;
    const id = store.createConversation(modelId, scene.title, project.id);
    store.addMessage(id, {
      role: 'user', content: scene.prompt, uuid,
      ...(scene.receipt ? { attachments: [{
        id: 'a1ec0000-0000-4000-8000-000000000099', type: 'image' as const,
        uri: receiptPath, mimeType: 'image/png', width: 900, height: 1200,
        fileName: 'Acme-lunch-receipt.png',
      }] } : {}),
    });
    if (scene.reply) store.addMessage(id, scene.reply);
    chats++;
  }
  await waitForChatPersistence();

  const warnings: string[] = [];
  // Use the optional Pro module boundary; free builds keep the core demo only.
  const pro = require('@offgrid/pro');
  if (pro?.seedDemoSyncData) {
    try { await pro.seedDemoSyncData(); }
    catch (error) { warnings.push(`Sync demo: ${error instanceof Error ? error.message : String(error)}`); }
  }

  let documents = 0;
  const notes = [
    { title: 'Promises to Sam', text: commitments },
    {
      title: 'Acme pilot brief',
      text: 'Alex at Off Grid AI is the user. Sam Okafor is the customer contact at Acme Corp. The pilot starts on 14 November with 40 seats. Priya Nair owns the rollout plan. Tom Reyes verifies the gateway policy before kickoff. Alex sends Sam the rollout plan on Friday at 10 AM. The source documents are Acme_rollout_v3.pdf and Pilot_scope.docx. All content is synthetic demo data.',
    },
  ];
  for (const note of notes) {
    try {
      const existing = await ragService.getDocumentsByProject(project.id);
      if (existing.some(item => item.name === `${note.title}.txt`)) continue;
      await ragService.indexPastedText({ projectId: project.id, ...note });
      documents++;
    } catch (error) {
      warnings.push(
        `${note.title}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const fileName = 'Acme_rollout_v3.pdf';
  const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  try {
    const existing = await ragService.getDocumentsByProject(project.id);
    if (!existing.some(item => item.name === fileName)) {
      if (!(await RNFS.exists(filePath))) {
        await RNFS.writeFile(filePath, demoRolloutPdfBase64, 'base64');
      }
      const stat = await RNFS.stat(filePath);
      await ragService.indexDocument({
        projectId: project.id,
        filePath,
        fileName,
        fileSize: Number(stat.size),
      });
      documents++;
    }
  } catch (error) {
    warnings.push(
      `${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { chats, documents, warnings };
}
