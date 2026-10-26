# npm run test:wechat baseline comparison (2026-10-26)

Same machine, Node v23.9.0, same command.

| Tree | Location | Tests | Pass | Fail |
|---|---|---|---|---|
| a4d61a5 baseline | detached worktree in Claude scratchpad baseline-a4d61a5 | 304 | 300 | 4 |
| C13 working tree | D:\Projects\small-city-basketball | 317 | 313 | 4 |

Identical failing tests and messages in both trees (Windows environment):
1. all fulfillment visual fixtures use supported fields and meaningful, traceable template output
   AssertionError only UI icons and neutral placeholders, actual path uses backslashes.
2. public media keeps current data driven image/video types and default empty state
3. approved booking fixtures render real controls and separate example portraits from real data
4. component templates, styles and modules cannot follow symlinks outside the project
   Error EPERM symlink not permitted.

No C13 regression: the 13 added tests pass and no previously passing test fails.
