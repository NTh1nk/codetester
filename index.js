import express from "express";
import { v5 as uuidv5 } from "uuid";
import crypto from "crypto";

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
export default (app, { getRouter }) => {
	// Your code here
	app.log.info("Yay, the app was loaded!");
	app.log.info(app.state.octokit.issues);
	// Simple API endpoint that logs when pinged
	const router = getRouter();

	router.use(express.static("public"));

	let lastContext = null;
	let lastCommentId = null;

	// Function to generate UUID based on repo owner and name
	function generateRepoUUID(owner, repoName) {
		try {
			// Create a namespace UUID for this application
			const NAMESPACE = uuidv5('https://github.com', uuidv5.URL);
			
			// Create a deterministic string from owner and repo name
			const repoString = `${owner}/${repoName}`;
			
			// Generate UUID v5 based on the repo string
			return uuidv5(repoString, NAMESPACE);
		} catch (error) {
			console.error("Failed to generate UUID:", error);
			// Generate a fallback UUID based on timestamp and random data
			const fallbackString = `${owner}/${repoName}/${Date.now()}`;
			return uuidv5(fallbackString, uuidv5.URL);
		}
	}

	// Simple route that comments on a pull request
	router.get("/comment", async (req, res) => {
		const { commentString } = req.query;
		if (!lastContext) {
			return res.send("No context found");
		}
		console.log(lastCommentId);
		console.log();
		console.log("Attempting to update comment via API call...");
		console.log("Comment content:", commentString);
		const comment = await lastContext.octokit.issues.updateComment(
			lastContext.issue({
				body: commentString,
				comment_id: lastCommentId,
			})
		);

		const issueUrl = lastContext.payload.issue.html_url;
		console.log("Issue URL: " + issueUrl);
		res.send("Comment posted!");
	});

	app.on("issues.opened", async (context) => {
		lastContext = context;
		app.log.info(context);

		// Generate UUID for this repository
		const repoOwner = context.payload.repository.owner.login;
		const repoName = context.payload.repository.name;
		const repoUUID = generateRepoUUID(repoOwner, repoName);
		console.log(`Repository UUID for ${repoOwner}/${repoName}: ${repoUUID}`);

		// Get the issue URL
		const issueUrl = context.payload.issue.html_url;
		console.log("Issue URL: " + issueUrl);

		const issueComment = context.issue({
			body: "Thanks for opening this issue!",
		});
		console.log(
			"Attempting to create initial comment for opened issue...",
			issueComment
		);
		const comment = await context.octokit.issues.createComment(issueComment);
		lastCommentId = comment.data.id;
		console.log("lastCommentId", lastCommentId);
		return comment;
	});

	app.on("pull_request.opened", async (context) => {
		lastContext = context;
		app.log.info("Pull request opened:", context.payload.pull_request.html_url);

		// Generate UUID for this repository
		const repoOwner = context.payload.repository.owner.login;
		const repoName = context.payload.repository.name;
		const repoUUID = generateRepoUUID(repoOwner, repoName);
		console.log(`Repository UUID for ${repoOwner}/${repoName}: ${repoUUID}`);

		// Variable to store browser flow for later use
		let browserFlow = "";

		// initial comment
		const initialComment = context.issue({
			body: "Thanks for opening this pull request! I'm analyzing your PR and will provide a detailed report shortly.",
		});
		console.log(
			"Attempting to create initial comment for opened pull request..."
		);
		const comment = await context.octokit.issues.createComment(initialComment);
		lastCommentId = comment.data.id;
		console.log("lastCommentId", lastCommentId);

		// Get PR title and description
		const prTitle = context.payload.pull_request.title;
		const prDescription = context.payload.pull_request.body || "No description";

		console.log("PR Title:", prTitle);
		console.log("PR Description:", prDescription);

		// Get README content
		let readmeText = "";
		try {
			const readme = await context.octokit.rest.repos.getReadme({
				owner: context.payload.repository.owner.login,
				repo: context.payload.repository.name,
			});

			// Decode base64 content
			console.log("README:", readme);
			const readmeContent = readme.data.content;
			console.log("README Content:", readme.data);
			console.log("README Content:", readme.data.download_url);
			const readmeResponse = await fetch(readme.data.download_url);
			readmeText = await readmeResponse.text();
			console.log("README Text:", readmeText);
		} catch (error) {
			console.log("Could not fetch README:", error.message);
			readmeText = ""; // Set empty string if README fetch fails
		}

		// Send analysis request regardless of README fetch result
		const requestBody = JSON.stringify({
			pr_title: prTitle,
			pr_description: prDescription,
			repo_readme: readmeText,
			repo_uuid: repoUUID,
			repo_owner: repoOwner,
			repo_name: repoName,
		});

		try {
			const markdownReport = await fetch("http://localhost:8000/analyze-pr", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: requestBody,
			});

			if (markdownReport.ok) {
				const response = await markdownReport.json();
				console.log("Analysis response:", response);

				// Store browser flow for later use
				browserFlow = response.browser_flow;

				// update the PR comment with the response
				const commentBody =
					response.pr_comment +
					"\n\n" +
					"<details>\n" +
					"  <summary>Click to expand browser flow details</summary>\n\n" +
					"  " +
					response.browser_flow +
					"\n\n" +
					"</details>";

				console.log("Attempting to update comment with analysis results...");
				console.log("Comment content:", commentBody);
				await context.octokit.issues.updateComment(
					context.issue({
						body: commentBody,
						comment_id: lastCommentId,
					})
				);
				// You can use the response here to update the PR comment
			} else {
				console.log("Failed to analyze PR:", markdownReport.status);
			}
		} catch (error) {
			console.log("Failed to send analysis request:", error.message);
			// Set a default browser flow if analysis fails
			browserFlow =
				"Default browser flow: Navigate to the application and perform basic functionality testing.";
		}

		console.log(
			"context.payload.pull_request.html_url" +
				context.payload.pull_request.html_url
		);

		// Every 5 seconds
		const interval = setInterval(async () => {
			try {
				// Get all comments from the current PR/issue
				const comments = await context.octokit.issues.listComments(
					context.issue()
				);

				console.log("=== All Comments ===");
				console.log(`Total comments: ${comments.data.length}`);

				// comments.data.forEach((comment, index) => {
				// 	console.log(`\nComment ${index + 1}:`);
				// 	console.log(`ID: ${comment.id}`);
				// 	console.log(`Author: ${comment.user.login}`);
				// 	console.log(`Created: ${comment.created_at}`);
				// 	console.log(`Updated: ${comment.updated_at}`);
				// 	console.log(`Body: ${comment.body}`);
				// 	console.log(`URL: ${comment.html_url}`);
				// 	console.log("---");
				// });

				const comment = comments.data.find(
					(comment) => comment.user.login === "vercel[bot]"
				);

				if (comment) {
					// console.log("Vercel Comment found:", comment);
					const commentBody = comment.body;
					if (commentBody.toLowerCase().includes("building")) {
						return;
					}
					if (commentBody.toLowerCase().includes("ready")) {
						console.log("Vercel finished building:", comment);
						clearInterval(interval);
						const commentBody = comment.body;

						// Extract the preview link from markdown format [Visit Preview](url)
						const linkMatch = commentBody.match(
							/\[Visit Preview\]\((https?:\/\/[^\)]+)\)/
						);
						if (linkMatch) {
							const previewUrl = linkMatch[1];
							console.log("Preview URL:", previewUrl);

							// Send POST request to QA test endpoint
							try {
								console.log("Sending QA test request...");
								console.log("browserFlow:", browserFlow);
								console.log("previewUrl:", previewUrl);
								console.log("repositoryUuid:", repoUUID);

								const qaTestResponse = await fetch(
									"http://localhost:4000/qa-test",
									{
										method: "POST",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											url: previewUrl,
											promptContent: browserFlow || "No browser flow available",
											repositoryUuid: repoUUID,
											repo_owner: repoOwner,
											repo_name: repoName,
										}),
									}
								);

								console.log("QA test response:", qaTestResponse);

								if (qaTestResponse.ok) {
									const qaResult = await qaTestResponse.json();
									console.log("QA test response:", qaResult);

									const resultComment = qaResult.githubComment;
									// update the comment
									console.log(
										"Attempting to update comment with QA test results..."
									);
									console.log(
										"Comment content:",
										resultComment +
											"\n\n" +
											`[Show in Dashboard](http://20.84.58.132:7777/${repoUUID})`
									);
									await context.octokit.issues.updateComment(
										context.issue({
											body:
												resultComment +
												"\n\n" +
												`[Show in Dashboard](http://20.84.58.132:7777/${repoUUID})`,
											comment_id: lastCommentId,
										})
									);
								} else {
									console.log(
										"Failed to send QA test request:",
										qaTestResponse.status
									);
									// Try to get the error response body
									let errorBody = "Unknown error";
									try {
										errorBody = await qaTestResponse.text();
										console.log("Error response body:", errorBody);
									} catch (e) {
										console.log("Could not read error response body");
									}

									// Update comment with error information but still provide useful info
									const errorComment = `## 🚀 Vercel Deployment Ready!

Your application has been successfully deployed to Vercel!

**Preview URL:** ${previewUrl}

## ⚠️ QA Testing Status

Unfortunately, the automated QA testing failed with the following error:
\`\`\`
${errorBody}
\`\`\`

**Repository UUID:** ${repoUUID}

You can still manually test your application using the preview URL above.

${browserFlow ? `**Browser Flow:**\n${browserFlow}` : ''}

[Show in Dashboard](http://20.84.58.132:7777/${repoUUID})`;

									await context.octokit.issues.updateComment(
										context.issue({
											body: errorComment,
											comment_id: lastCommentId,
										})
									);
								}
							} catch (error) {
								console.log("Error sending QA test request:", error.message);
								
								// Update comment with error information but still provide useful info
								const errorComment = `## 🚀 Vercel Deployment Ready!

Your application has been successfully deployed to Vercel!

**Preview URL:** ${previewUrl}

## ⚠️ QA Testing Status

The automated QA testing encountered an error:
\`\`\`
${error.message}
\`\`\`

**Repository UUID:** ${repoUUID}

You can still manually test your application using the preview URL above.

${browserFlow ? `**Browser Flow:**\n${browserFlow}` : ''}

[Show in Dashboard](http://20.84.58.132:7777/${repoUUID})`;

								await context.octokit.issues.updateComment(
									context.issue({
										body: errorComment,
										comment_id: lastCommentId,
									})
								);
							}
						} else {
							console.log("No preview link found in comment");
						}
					}
				}
			} catch (error) {
				console.error("Error fetching comments:", error.message);
			}
		}, 1000);

		// request info from external api (port 8000)

		//curl -X POST "http://localhost:8000/generate" \
		// -H "Content-Type: application/json" \
		// -d '{"url": "https://github.com/owner/repo/pull/123"}'

		// const requestBody = JSON.stringify({
		// 	url: context.payload.pull_request.html_url,
		// });
		// console.log(requestBody);

		// const markdownReport = await fetch("http://localhost:8000/generate", {
		// 	method: "POST",
		// 	headers: {
		// 		"Content-Type": "application/json",
		// 	},
		// 	body: requestBody,
		// });

		// if (markdownReport.ok) {
		// 	const markdownReportText = (await markdownReport.json()).markdown_report;
		// 	console.log("markdownReportText", markdownReportText);
		// 	await context.octokit.issues.updateComment(
		// 		context.issue({
		// 			body: markdownReportText,
		// 			comment_id: lastCommentId,
		// 		})
		// 	);
		// } else {
		// 	console.log("Failed to get markdown report");
		// }

		// return markdownReportText;
	});
	// For more information on building apps:
	// https://probot.github.io/doc

	// To get your app running against GitHub, see:
	// https://probot.github.io/docs/development/
};
