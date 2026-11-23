# Accepted differences and team rules

What the team has decided about differences between the sheets and the applications. A new story follows these from the
start; a reviewer's verdict on the dashboard that accepts a difference ("Should pass" because the requirement changed -
tests/pages/<page>/review.json) is added here once Claude has turned it into a rule. Facts about the applications are in [app-knowledge.md](app-knowledge.md).

## Rules for every story
| Rule | What the tests do |
|---|---|
| A case that needs the server to fail (HTTP 500, "server error") | **Not applicable** - the tests cannot make the server fail |
| A case that checks a specific HTTP error code the application answers differently | **Not applicable** - HTTP codes are not tested |
| Wording differs but the meaning is the same (labels, messages) | Accepted - checks compare the meaning, not the exact text |
| The node name (top of an Umbraco form) vs the sheet's Title / Name | The sheet's Title / Name is the form's own field, never the node name |
| A case that needs access we do not have (mobile app, e-mail inbox, payment gateway, Active Directory admin) | Blocked, with what access would unblock it |
| A case about a feature that was removed | Not applicable |
| A case can be tried 3 times when a step does not go through; then it is blocked with the reason | (built in) |

## Back office
| Story | Difference | Decision |
|---|---|---|
| - | (none yet) | |

## Public portal
| Story | Difference | Decision |
|---|---|---|
| - | (none yet) | |
