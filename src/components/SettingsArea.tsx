import { Component, Switch, Match } from 'solid-js';
import type { ApiProviderSummary, RemoteModel } from '../lib/backend';
import { type MessageFormatConfig } from '../lib/messageFormatter';
import { WorkspaceTransitionStage } from './WorkspaceTransitionStage';
import { ApiProviderManager } from './settings/ApiProviderManager';
import { AppearanceSettings } from './settings/AppearanceSettings';
import type { ProviderSavePayload } from './settings/ProviderForm';
import type { ClaudeTestPayload, ProviderClaudeNativeTestResult } from './settings/ClaudeNativeTestPanel';

interface SettingsAreaProps {
  activeCategory: string;
  providers: ApiProviderSummary[];
  modelsByProvider?: Record<number, RemoteModel[]>;
  loading?: boolean;
  fetchingModelsFor?: number | null;
  onFetchModels: (providerId: number) => Promise<void> | void;
  onSaveProvider: (payload: ProviderSavePayload) => Promise<void> | void;
  onDeleteProvider: (id: number) => Promise<void> | void;
  onTestClaudeNative: (payload: ClaudeTestPayload) => Promise<ProviderClaudeNativeTestResult> | ProviderClaudeNativeTestResult;
  enableDynamicEffects: boolean;
  onSetEnableDynamicEffects: (enabled: boolean) => void;
  formatConfig: MessageFormatConfig;
  onSetFormatConfig: (config: MessageFormatConfig) => void;
  /** mem0 startup error — displayed as a warning banner in the API section. */
  mem0InitError?: string | null;
}

export const SettingsArea: Component<SettingsAreaProps> = (props) => {
  return (
    <div class="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
      <WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={['api', 'appearance']}>
        {(categoryId) => (
          <Switch fallback={<div />}>
            <Match when={categoryId === 'api'}>
              <ApiProviderManager
                providers={props.providers}
                modelsByProvider={props.modelsByProvider}
                loading={props.loading}
                fetchingModelsFor={props.fetchingModelsFor}
                onFetchModels={props.onFetchModels}
                onSaveProvider={props.onSaveProvider}
                onDeleteProvider={props.onDeleteProvider}
                onTestClaudeNative={props.onTestClaudeNative}
                mem0InitError={props.mem0InitError}
              />
            </Match>
            <Match when={categoryId === 'appearance'}>
              <AppearanceSettings
                enableDynamicEffects={props.enableDynamicEffects}
                onSetEnableDynamicEffects={props.onSetEnableDynamicEffects}
                formatConfig={props.formatConfig}
                onSetFormatConfig={props.onSetFormatConfig}
              />
            </Match>
            <Match when={categoryId !== 'api' && categoryId !== 'appearance'}>
              <div class="h-[60vh] flex flex-col items-center justify-center text-mist-solid/20">
                <p class="text-xl font-bold mb-2">正在设计中</p>
                <p class="text-sm italic">此功能模块暂未接入真实后端</p>
              </div>
            </Match>
          </Switch>
        )}
      </WorkspaceTransitionStage>
    </div>
  );
};
