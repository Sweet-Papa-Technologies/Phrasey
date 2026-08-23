import { InfinityProvider } from './infinity.js';
import type { Provider } from './types.js';
import { VertexProvider, VERTEX_CHEAP_MODEL } from './vertex.js';

export * from './types.js';
export { InfinityProvider } from './infinity.js';
export { VertexProvider, VERTEX_FAST_MODEL, VERTEX_CHEAP_MODEL } from './vertex.js';

export const PROVIDER_NAMES = ['infinity', 'vertex', 'vertex-cheap'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function makeProvider(name: string): Provider {
  switch (name) {
    case 'infinity':
      return new InfinityProvider();
    case 'vertex':
      return new VertexProvider();
    case 'vertex-cheap':
      return new VertexProvider(VERTEX_CHEAP_MODEL);
    default:
      throw new Error(`Unknown provider "${name}". Expected one of: ${PROVIDER_NAMES.join(', ')}`);
  }
}
