/**
 * The project's standing rules for test cases that cannot be tested (docs/NEW_USER_STORY.md), applied to a case's text when
 * a new story is added (npm run story:new): such a case starts as not applicable, with the reason. Cases that ask for an
 * HTTP status code are only pointed out (mentionsStatusCode). Pure: text in, reason out.
 * A case the rules miss is decided by hand, as before; one they catch wrongly is made applicable again on the dashboard.
 */
const RULES: readonly { reason: string; pattern: RegExp }[] = [
  {
    reason: 'Needs the server to fail (a server error) - the tests cannot make the server fail',
    pattern: /\bserver(?:-side)? (?:encounters? |returns? |has |throws? )?(?:an? )?(?:unexpected )?(?:internal )?(?:error|failure)|encounters an? (?:unexpected )?(?:internal|server(?:-side)?) error|(?:HTTP|status|error|code) ?500\b|\b500 (?:error|internal)|internal server error|server is (?:down|unavailable)|service (?:is )?unavailable/i,
  },
  {
    reason: 'Needs the network to fail - the tests cannot cut the connection',
    pattern: /\b(?:network|connection|internet) (?:failure|error|is lost|drops|disconnect)|\boffline\b|connection (?:times? out|timeout)/i,
  },
];

/** The standing rule a case falls under (its When and Then), with the reason; undefined when none does. */
export const standingNotApplicable = (text: string): string | undefined => RULES.find((rule) => rule.pattern.test(text))?.reason;

/**
 * Whether a case asks for an HTTP status code. Not decided here: a case whose substance is the status code alone is not
 * applicable (the back office answers its own codes), but one that also checks what the user sees is tested for that part -
 * story:new lists these cases so they are decided one by one.
 */
export const mentionsStatusCode = (text: string): boolean =>
  /\bHTTP (?:status |error )?(?:code )?\d{3}\b|\b(?:status|error|response) code\b|\b(?:returns?|responds? with) (?:an? )?(?:HTTP )?[2-5]\d{2}\b/i.test(text);
