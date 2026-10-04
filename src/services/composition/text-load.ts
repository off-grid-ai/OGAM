// Composition root: shared text-load admission, native load ladder, and load-policy projection
// over Mobile's filesystem, llama.rn, and residency ports.
import type { LlamaContext } from 'llama.rn';
import {
  LoadPolicyTransitionCoordinator,
  NativeLoadService,
  TextLoadAdmissionService,
  once,
} from '@offgrid/models';
import { mobileTextLoadAdmissionPorts } from '../llmAdmissionPorts';
import { mobileNativeLoadPorts } from '../adapters/native/nativeTextLoadPorts';
import { mobileLoadPolicyPorts } from '../modelServices/loadPolicyPorts';

export const textLoadAdmission = once(
  () => new TextLoadAdmissionService(mobileTextLoadAdmissionPorts()),
);
export const nativeTextLoad = once(
  () => new NativeLoadService<LlamaContext>(mobileNativeLoadPorts()),
);
/** One coordinator per load-policy projection lifetime. */
export function loadPolicyTransition(): LoadPolicyTransitionCoordinator {
  return new LoadPolicyTransitionCoordinator(mobileLoadPolicyPorts());
}
