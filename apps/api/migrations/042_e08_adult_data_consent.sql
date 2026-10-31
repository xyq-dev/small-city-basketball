-- E08 adult processing renewal. Age evidence is private; no DOB/identity is stored here.
CREATE TABLE youth_adult_data_consents (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES users(id),
 performed_by uuid NOT NULL REFERENCES users(id),
 client_request_id uuid NOT NULL,
 org_id uuid NOT NULL,event_id uuid NOT NULL,team_id uuid NOT NULL,
 entry_id uuid NOT NULL,member_id uuid NOT NULL,binding_id uuid NOT NULL REFERENCES team_member_bindings(id),
 material_id uuid NOT NULL,material_revision_id uuid NOT NULL,
 age_evidence_qualification_id uuid NOT NULL REFERENCES participant_qualification_prechecks(id),
 policy_version integer NOT NULL CHECK(policy_version>0),
 terms_version text NOT NULL CHECK(terms_version='youth-adult-data-processing-v1'),
 material_version integer NOT NULL CHECK(material_version>0),
 version integer NOT NULL CHECK(version>0),
 decision text NOT NULL CHECK(decision IN('CONSENT','WITHDRAW')),
 cause text NOT NULL DEFAULT 'SELF' CHECK(cause IN('SELF','ACCOUNT_CLOSURE','RESTORE_QUARANTINE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,client_request_id),
 UNIQUE(actor_id,org_id,event_id,entry_id,member_id,version),
 FOREIGN KEY(org_id,event_id) REFERENCES events(org_id,id),
 FOREIGN KEY(org_id,event_id,entry_id) REFERENCES entries(org_id,event_id,id),
 FOREIGN KEY(org_id,event_id,team_id,entry_id,member_id,actor_id,material_id)
  REFERENCES participant_materials(org_id,event_id,team_id,entry_id,member_id,user_id,id),
 FOREIGN KEY(org_id,event_id,material_id,material_revision_id)
  REFERENCES participant_material_revisions(org_id,event_id,material_id,id),
 CHECK(decision<>'CONSENT' OR (performed_by=actor_id AND cause='SELF'))
);
CREATE INDEX youth_adult_consent_current ON youth_adult_data_consents(actor_id,org_id,event_id,entry_id,member_id,version DESC);
CREATE TRIGGER youth_adult_data_consent_immutable BEFORE UPDATE OR DELETE ON youth_adult_data_consents
 FOR EACH ROW EXECUTE FUNCTION e08_immutable_guardian_fact();
