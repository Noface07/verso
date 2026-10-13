import { isTauri } from './tauri';
import { handleOpenedFile } from './tauriIntegration';
import { initAndroidBackHandler } from './backStack';

/**
 * Initializes Android-specific system integrations:
 * - Back button stack handler (layers dismiss in order, falls back to route back)
 * - ACTION_VIEW and ACTION_SEND file import
 */
export function initAndroidIntegration(
  navigate: (path: string) => void,
  goBack: () => void,
): () => void {
  if (!isTauri()) return () => {};

  // Setup Back Button Stack
  const cleanupBack = initAndroidBackHandler(() => {
    goBack();
  });

  // Setup Intent & File Open listener
  let cleanupFileOpen = () => {};
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      cleanupFileOpen = await listen<string>('folio://file-open', (event) => {
        if (event.payload) {
          void handleOpenedFile(event.payload, (bookId) => {
            navigate(`/reader/${bookId}`);
          });
        }
      });
    } catch (err) {
      console.warn('Failed to register Android intent listener:', err);
    }
  })();

  return () => {
    cleanupBack();
    cleanupFileOpen();
  };
}
