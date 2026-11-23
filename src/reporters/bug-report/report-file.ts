/** Where the bug report of a user story is written and what it is called. Shared by the reporter and the dashboard. */
export const REPORT_FOLDER = 'test-output/bug-reports';

export const reportFileName = (story: string): string => `${story} bug report.docx`;
