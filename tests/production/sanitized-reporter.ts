import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

/** Failure diagnostics can contain a read secret from page.goto. Emit only fixed
 * test titles/status; never delegate to a reporter that renders errors/artifacts. */
export default class SanitizedReporter implements Reporter {
  private executed = 0;
  onBegin(_config: FullConfig, suite: Suite) {
    process.stdout.write(`P07 HTTPS browser checks discovered: ${suite.allTests().length}\n`);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.executed++;
    const label =
      test.title === 'private deep link, login and registration capabilities'
        ? 'private-login-capabilities'
        : 'anonymous-watch-overlay';
    const stage = result.errors
      .map((error) => error.message?.match(/P07_CHECK:([a-z0-9-]+)/)?.[1])
      .find(Boolean);
    const device = test.titlePath().includes('mobile-https') ? 'mobile' : 'desktop';
    process.stdout.write(
      `P07 HTTPS browser ${device} ${label}: ${result.status}${stage ? ` (${stage})` : ''}\n`,
    );
  }
  onError() {
    process.stderr.write('P07 HTTPS browser runner failed; sensitive diagnostics suppressed.\n');
  }
  onEnd(result: FullResult) {
    process.stdout.write(`P07 HTTPS browser suite: ${result.status} (${this.executed} executed)\n`);
  }
  printsToStdio() {
    return true;
  }
}
