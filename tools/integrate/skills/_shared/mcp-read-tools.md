Only analyzr's read-only MCP tools, and only these: `list_processes`, `get_process`,
`which_processes_use`, `find_unlinked_events`, `get_value_chain` and `get_landscape` (only for a
project of at most 40 models). They read the landscape and change nothing. They come from an MCP
server of their own, `analyzr-lesen` (tools `mcp__analyzr-lesen__<tool>`), whose token can only
read: the consultant creates it in a terminal
(`<cli> --url "<analyzrUrl>" token create -p <project> -n interviews -s analyzr:read`) and runs
the `claude mcp add` line it prints there with the server name `analyzr-lesen` instead of
`analyzr`, never in the chat. Never use the tools of another analyzr server (`mcp__analyzr__…`):
its token may be one of the analysis runs, which can also propose. Claude Code asks before each
tool call: the consultant allows these tools one by one, never all of a server at once.
