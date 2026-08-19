export interface CustomIconData {
  body: string;
  [key: string]: unknown;
}

export interface CustomIconInfo {
  prefix: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

export const icons: Record<string, CustomIconData>;
export const info: CustomIconInfo;
