import { Image } from "react-native";
import { manipulateAsync, SaveFormat, type Action } from "expo-image-manipulator";

const MAX_EDGE = 1600;

function getSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err)
    );
  });
}

export async function compressForUpload(uri: string): Promise<string> {
  try {
    const { width, height } = await getSize(uri);
    const longest = Math.max(width, height);
    const actions: Action[] = [];
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest;
      actions.push({
        resize: {
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        },
      });
    }
    const result = await manipulateAsync(uri, actions, {
      compress: 0.72,
      format: SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    return uri;
  }
}
