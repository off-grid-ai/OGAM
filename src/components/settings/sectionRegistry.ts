import type { ComponentType } from 'react';

const sections: ComponentType<any>[] = [];

export function registerSettingsSection(component: ComponentType<any>): void {
  if (!sections.includes(component)) {
    sections.push(component);
  }
}

export function getSettingsSections(): ComponentType<any>[] {
  return sections;
}

export function _clearSectionsForTesting(): void {
  sections.length = 0;
}
