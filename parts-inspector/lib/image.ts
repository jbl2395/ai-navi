'use client';

/** 履歴に保存するサムネイルの一辺（px） */
const THUMBNAIL_SIZE = 128;

/**
 * 撮影画像から軽量なサムネイルを作る。
 * 履歴を localStorage に保存するため、原寸のままだと容量を超えてしまう。
 */
export function createThumbnail(dataUrl: string, size = THUMBNAIL_SIZE): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const context = canvas.getContext('2d');
      if (!context) {
        resolve(dataUrl);
        return;
      }

      // 撮影画像は検査枠で正方形に切り出し済みなので、そのまま縮小する
      context.drawImage(image, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };

    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}
