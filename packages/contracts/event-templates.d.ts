import type {
  EventData,
  EventFormat,
  RegistrationRulesInput,
  ScoringRules,
  StandingsRules,
} from './index.js';

export interface EventTemplateScheduling {
  dailyStart: string;
  dailyEnd: string;
  slotDurationMinutes: number;
  minRestMinutes: number;
  minLocalDayGap: number;
  groupCount: 2 | 4 | 8 | null;
  thirdPlaceMatch: boolean;
}
/** Configuration only. No identities, teams, permissions, court ids or old dates. */
export interface EventTemplateConfiguration {
  format: EventFormat;
  registration: Omit<RegistrationRulesInput, 'expectedVersion'>;
  scoring: ScoringRules;
  standings: StandingsRules | null;
  scheduling: EventTemplateScheduling;
  expectedTeams: number | null;
}
export interface EventTemplateData {
  id: string;
  name: string;
  version: number;
  versionId: string;
  status: 'ACTIVE' | 'ARCHIVED';
  configuration: EventTemplateConfiguration;
  configurationHash: string;
  createdAt: string;
  updatedAt: string;
}
export interface EventTemplatePreset {
  key: 'EIGHT_TEAM_GROUP_BRONZE_V1';
  name: string;
  configuration: EventTemplateConfiguration;
  expectedTotalMatches: 16;
}
export interface EventTemplateCatalog {
  templates: EventTemplateData[];
  presets: EventTemplatePreset[];
  truncated: boolean;
  capabilities: { canManageTemplates: boolean; canInstantiate: boolean };
}
export interface EventTemplateCommandReceipt {
  clientRequestId: string;
  operation: 'CREATE_TEMPLATE' | 'UPDATE_TEMPLATE' | 'ARCHIVE_TEMPLATE' | 'INSTANTIATE';
  template: EventTemplateData;
  event: EventData | null;
}
export interface EventSetupGuide {
  eventVersion: number;
  template: {
    id: string;
    versionId: string;
    expectedTeams: number | null;
    configuration: EventTemplateConfiguration;
  } | null;
  steps: {
    code: 'CONFIGURE' | 'REGISTRATION' | 'FREEZE' | 'DRAW' | 'ALLOCATE' | 'PUBLISH';
    title: string;
    state: 'COMPLETE' | 'CURRENT' | 'BLOCKED' | 'WAITING';
    blockers: string[];
    action: 'SETUP' | 'REGISTRATION' | 'SCHEDULING' | 'EVENT';
  }[];
  counts: {
    approved: number;
    submitted: number;
    changesRequested: number;
    frozen: number;
    fixtures: number;
    assigned: number;
  };
  published: boolean;
  canManage: boolean;
}
