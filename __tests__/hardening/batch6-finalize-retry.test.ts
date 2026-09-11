import { ModelDownloadCoordinator } from '@offgrid/models';

function operation() {
  const paths = new Set<string>();
  const coordinator = new ModelDownloadCoordinator({
    persistence: { read: async () => [], write: async () => undefined },
    files: {
      pathFor: name => `/models/${name}`,
      exists: async path => paths.has(path),
      size: async () => 1024,
      readPrefix: async () => Uint8Array.from([0x47, 0x47, 0x55, 0x46]),
      remove: async path => { paths.delete(path); },
    },
    transfers: {
      start: async input => {
        input.onStarted?.('native-1');
        paths.add(input.destination);
        return {};
      },
    },
  });
  return coordinator.enqueueWithHandle({
    id: 'text:model', modelId: 'owner/model', kind: 'text', revision: 'mobile',
    artifacts: [{
      id: 'primary', name: 'model.gguf', localName: 'model.gguf',
      url: 'https://example/model.gguf', sizeBytes: 1024, role: 'primary', required: true,
    }],
  });
}

test('completion is replayed once to every late watcher', async () => {
  const handle = operation();
  await handle.completion;
  const first: string[] = [];
  const second: string[] = [];
  handle.subscribe(event => first.push(event.type));
  handle.subscribe(event => second.push(event.type));
  expect(first.filter(type => type === 'completed')).toHaveLength(1);
  expect(second.filter(type => type === 'completed')).toHaveLength(1);
});

test('retry uses one operation identity and does not create duplicate terminal events', async () => {
  const handle = operation();
  const events: string[] = [];
  handle.subscribe(event => events.push(event.type));
  await handle.completion;
  expect(events.filter(type => type === 'completed')).toHaveLength(1);
  expect(events.filter(type => type === 'failed')).toHaveLength(0);
});
