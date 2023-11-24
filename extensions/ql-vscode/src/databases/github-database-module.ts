import { window } from "vscode";
import { DisposableObject } from "../common/disposable-object";
import { App } from "../common/app";
import { findGitHubRepositoryForWorkspace } from "./github-repository-finder";
import { redactableError } from "../common/errors";
import { asError, assertNever, getErrorMessage } from "../common/helpers-pure";
import {
  askForGitHubDatabaseDownload,
  downloadDatabaseFromGitHub,
} from "./github-database-download";
import { GitHubDatabaseConfig, GitHubDatabaseConfigListener } from "../config";
import { DatabaseManager } from "./local-databases";
import { CodeQLCliServer } from "../codeql-cli/cli";
import {
  CodeqlDatabase,
  listDatabases,
  ListDatabasesResult,
} from "./github-database-api";
import {
  askForGitHubDatabaseUpdate,
  DatabaseUpdate,
  downloadDatabaseUpdateFromGitHub,
  isNewerDatabaseAvailable,
} from "./github-database-updates";
import { Octokit } from "@octokit/rest";

export class GithubDatabaseModule extends DisposableObject {
  private readonly config: GitHubDatabaseConfig;

  private constructor(
    private readonly app: App,
    private readonly databaseManager: DatabaseManager,
    private readonly databaseStoragePath: string,
    private readonly cliServer: CodeQLCliServer,
  ) {
    super();

    this.config = this.push(new GitHubDatabaseConfigListener());
  }

  public static async initialize(
    app: App,
    databaseManager: DatabaseManager,
    databaseStoragePath: string,
    cliServer: CodeQLCliServer,
  ): Promise<GithubDatabaseModule> {
    const githubDatabaseModule = new GithubDatabaseModule(
      app,
      databaseManager,
      databaseStoragePath,
      cliServer,
    );
    app.subscriptions.push(githubDatabaseModule);

    await githubDatabaseModule.initialize();
    return githubDatabaseModule;
  }

  private async initialize(): Promise<void> {
    if (!this.config.enable) {
      return;
    }

    // Start the check and downloading the database asynchronously. We don't want to block on this
    // in extension activation since this makes network requests and waits for user input.
    void this.promptGitHubRepositoryDownload().catch((e: unknown) => {
      const error = redactableError(
        asError(e),
      )`Failed to prompt for GitHub repository download`;

      void this.app.logger.log(error.fullMessageWithStack);
      this.app.telemetry?.sendError(error);
    });
  }

  private async promptGitHubRepositoryDownload(): Promise<void> {
    if (this.config.download === "never") {
      return;
    }

    const githubRepositoryResult = await findGitHubRepositoryForWorkspace();
    if (githubRepositoryResult.isFailure) {
      void this.app.logger.log(
        `Did not find a GitHub repository for workspace: ${githubRepositoryResult.errors.join(
          ", ",
        )}`,
      );
      return;
    }

    const githubRepository = githubRepositoryResult.value;

    let result: ListDatabasesResult | undefined;
    try {
      result = await listDatabases(
        githubRepository.owner,
        githubRepository.name,
        this.app.credentials,
        this.config,
      );
    } catch (e) {
      this.app.telemetry?.sendError(
        redactableError(
          asError(e),
        )`Failed to prompt for GitHub database download`,
      );

      void this.app.logger.log(
        `Failed to find GitHub databases for repository: ${getErrorMessage(e)}`,
      );

      return;
    }

    // This means the user didn't want to connect, so we can just return.
    if (result === undefined) {
      return;
    }

    const { databases, promptedForCredentials, octokit } = result;

    if (databases.length === 0) {
      // If the user didn't have an access token, they have already been prompted,
      // so we should give feedback.
      if (promptedForCredentials) {
        void window.showInformationMessage(
          "The GitHub repository does not have any CodeQL databases.",
        );
      }

      return;
    }

    const updateStatus = isNewerDatabaseAvailable(
      databases,
      githubRepository.owner,
      githubRepository.name,
      this.databaseManager,
    );

    switch (updateStatus.type) {
      case "upToDate":
        return;
      case "updateAvailable":
        await this.updateGitHubDatabase(
          octokit,
          githubRepository.owner,
          githubRepository.name,
          updateStatus.databaseUpdates,
        );
        break;
      case "noDatabase":
        await this.downloadGitHubDatabase(
          octokit,
          githubRepository.owner,
          githubRepository.name,
          databases,
          promptedForCredentials,
        );
        break;
      default:
        assertNever(updateStatus);
    }
  }

  private async downloadGitHubDatabase(
    octokit: Octokit,
    owner: string,
    repo: string,
    databases: CodeqlDatabase[],
    promptedForCredentials: boolean,
  ) {
    // If the user already had an access token, first ask if they even want to download the DB.
    if (!promptedForCredentials) {
      if (!(await askForGitHubDatabaseDownload(databases, this.config))) {
        return;
      }
    }

    await downloadDatabaseFromGitHub(
      octokit,
      owner,
      repo,
      databases,
      this.databaseManager,
      this.databaseStoragePath,
      this.cliServer,
      this.app.commands,
    );
  }

  private async updateGitHubDatabase(
    octokit: Octokit,
    owner: string,
    repo: string,
    databaseUpdates: DatabaseUpdate[],
  ): Promise<void> {
    if (this.config.update === "never") {
      return;
    }

    if (!(await askForGitHubDatabaseUpdate(databaseUpdates, this.config))) {
      return;
    }

    await downloadDatabaseUpdateFromGitHub(
      octokit,
      owner,
      repo,
      databaseUpdates,
      this.databaseManager,
      this.databaseStoragePath,
      this.cliServer,
      this.app.commands,
    );
  }
}