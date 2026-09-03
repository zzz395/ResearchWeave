INSERT INTO "agent_definitions" (
	"id",
	"space_id",
	"stable_key",
	"name",
	"purpose",
	"enabled",
	"system_managed",
	"revision",
	"limits_json",
	"prompt_version",
	"created_at",
	"updated_at"
) VALUES (
	'30000000-0000-4000-8000-000000000001',
	NULL,
	'research-agent',
	'Research Agent',
	'Conduct bounded research using approved academic and Space knowledge tools.',
	true,
	true,
	1,
	'{"maxSteps":8,"maxToolCalls":6,"wallTimeSeconds":180,"providerDecisionTimeoutSeconds":30,"toolTimeoutSeconds":45,"providerAttempts":2,"providerResponseMaxBytes":65536,"observationMaxBytes":32768,"contextMaxBytes":131072,"finalAnswerMaxCharacters":8000,"maxEvidence":32}'::jsonb,
	'research-agent-v1',
	'2026-09-03T00:00:00.000Z'::timestamptz,
	'2026-09-03T00:00:00.000Z'::timestamptz
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "agent_definition_tools" ("agent_id", "tool_name")
SELECT "id", tool."tool_name"
FROM "agent_definitions"
CROSS JOIN (
	VALUES
		('search_arxiv'),
		('search_knowledge_base'),
		('ask_knowledge')
) AS tool("tool_name")
WHERE "stable_key" = 'research-agent'
ON CONFLICT DO NOTHING;
