import { useGLTF } from "@react-three/drei";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

let didSetup = false;

/**
 * Configure GLTFLoader decoders used by `@react-three/drei`'s `useGLTF`.
 *
 * Ready Player Me avatars often use Meshopt (and sometimes Draco). Without these,
 * GLB loading fails and we fall back to the placeholder "dummy" avatar.
 */
export function setupGltfLoaders() {
  if (didSetup) return;
  didSetup = true;

  // Meshopt
  try {
    // drei forwards this into GLTFLoader.setMeshoptDecoder()
    (useGLTF as unknown as { setMeshoptDecoder?: (d: unknown) => void }).setMeshoptDecoder?.(MeshoptDecoder);
  } catch {
    // non-fatal; GLBs without meshopt still load
  }

  // Draco (optional)
  try {
    const draco = new DRACOLoader();
    // Public decoder CDN; keeps the repo lightweight.
    draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    (useGLTF as unknown as { setDRACOLoader?: (d: unknown) => void }).setDRACOLoader?.(draco);
  } catch {
    // non-fatal
  }
}

