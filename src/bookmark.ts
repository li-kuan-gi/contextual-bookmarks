// src/bookmark.ts
export interface Bookmark {
  id: string; // 用來唯一識別書籤
  fsPath: string; // 檔案路徑
  lineNumber: number; // 行號 (從 1 開始)
  label: string; // 顯示在側邊欄的文字
}
