// Composition root: shared text-engine control over Mobile's native runtimes.
import { TextEngineApplicationService, once } from '@offgrid/models';
import { mobileTextEnginePorts } from '../modelServices/textEnginePorts';

export const textEngineControl = once(() => new TextEngineApplicationService(mobileTextEnginePorts()));
