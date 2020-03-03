const playwright = require('playwright');
const looksSame = require('looks-same');
const combineImage = require('merge-img');
const AWS = require('aws-sdk');
const github = require('@actions/github');
const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const {
  stories,
  autoScroll,
  createScreenshot,
  screenshotPage,
  chunk,
  getChromePath
} = require('./lib');

const VARIABLE_URL = `file://${process.env.GITHUB_WORKSPACE}${core.getInput('storybook_iframe')}`;
const CONSTANT_URL = core.getInput('constant_url');
const build = core.getInput('storybook_build');
const github_token = core.getInput('github_token');
const s3_access_token = core.getInput('S3_access_token');
const s3_secret_token = core.getInput('S3_secret_token');
const s3_bucket = core.getInput('S3_bucket');
const s3_region = core.getInput('S3_region');
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const commit = process.env.GITHUB_SHA;
const pull_request = github.context.payload.pull_request;
const iPhone11 = playwright.devices['iPhone 11 Pro'];
const images = [];

if (!CONSTANT_URL) {
  core.warning('Constant URL was not set');
}

if (!github_token) {
  core.warning('Github token was not set');
}

const octokit = new github.GitHub(github_token);

const bucket = new AWS.S3({
  region: s3_region,
  accessKeyId: s3_access_token,
  secretAccessKey: s3_secret_token
});

const createCompareImage = async (first, second, third) => {
  return await combineImage(
    [
      { src: first, offsetY: 100 },
      { src: second, offsetX: 100, offsetY: 100 },
      { src: third, offsetX: 100, offsetY: 100 }
    ],
    { margin: '40 40 40 40' }
  );
};

const checkStory = async (arrDetails, context) => {
  for (const storyName of arrDetails) {
    const constant_url = `${CONSTANT_URL}?${storyName.url}`;
    const variable_url = `${VARIABLE_URL}?${storyName.url}`;
    const name = `${storyName.kind}-${storyName.name}`;
    const [constant_screenshot, variable_screenshot] = await Promise.all([
      createScreenshot(context, constant_url, name),
      createScreenshot(context, variable_url, name)
    ]);

    new Promise((resolve, reject) => {
      looksSame(constant_screenshot, variable_screenshot, (error, data) => {
        if (error) throw error;

        if (!data.equal) {
          looksSame.createDiff({
            reference: constant_screenshot,
            current: variable_screenshot,
            highlightColor: '#ff00ff', // color to highlight the differences
            strict: false, // strict comparsion
            tolerance: 2.5,
            antialiasingTolerance: 0,
            ignoreAntialiasing: true, // ignore antialising by default
            ignoreCaret: true // ignore caret by default
          }, async (error, buffer) => {
              if (error) throw error;
              const img = await createCompareImage(constant_screenshot, variable_screenshot, buffer);
              images.push(img);
              console.log(name, 'different');
              resolve();
          });
        } else {
          // console.log(name, 'the same');
          resolve();
        }
      });
    });

  }
};

const addIssueComment = (image) => {
  const body = `![Visual difference](${image})`;

  octokit.issues.createComment({
    owner,
    repo,
    issue_number: pull_request.number,
    body
  });
};

(async () => {
  await exec.exec(build);
  const opts = ['--no-sandbox', '--disable-setuid-sandbox'];
  const browser = await playwright.chromium.launch({
    opts,
    executablePath: getChromePath()
  });
  const context = await browser.newContext({
    viewport: iPhone11.viewport,
    userAgent: iPhone11.userAgent
  });
  const page = await context.newPage();
  const storyDetails = await stories(page, CONSTANT_URL);
  const storyBreakdown = chunk(storyDetails, 10);

  await Promise.all(storyBreakdown.map(async (arr) => { await checkStory(arr, context) }));

  if (images.length > 0) {
    combineImage(images, {direction: true})
    .then((img) => {
      const filename = `${commit}.png`;
      img.write(filename, async () => {
        const params = {
          Key: filename,
          Body: fs.createReadStream(filename),
          Bucket: s3_bucket,
          ACL:'public-read-write'
        };

        const image = await bucket.upload(params);

        addIssueComment(image.Location);
      });
    });
  }

  await browser.close();
})();
