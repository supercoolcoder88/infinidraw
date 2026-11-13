/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare var files: {
  save: (text: string) => Promise<void>;
  open: () => Promise<string | undefined>;
};
