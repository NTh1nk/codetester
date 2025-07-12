/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
export default (app) => {
	// Your code here
	app.log.info("Yay, the app was loaded!");

	app.on("issues.opened", async (context) => {
		app.log.info("Issue opened", context);
		const issueComment = context.issue({
			body: "Thanks for opening this issue!",
		});
		return context.octokit.issues.createComment(issueComment);
	});

	app.on("pull_request.opened", async (context) => {
		app.log.info("Pull request opened", context);
		const issueComment = context.issue({
			body: "Thanks for opening this pull request!",
		});
		return context.octokit.issues.createComment(issueComment);
	});
	// For more information on building apps:
	// https://probot.github.io/doc

	// To get your app running against GitHub, see:
	// https://probot.github.io/docs/development/
};
