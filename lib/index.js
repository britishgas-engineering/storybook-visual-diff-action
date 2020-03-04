const core = require('@actions/core');
const os = require('os');
const path = require('path');

const getStories = async (page, url) => {
  await page.goto(url, {
    waitUntil: 'networkidle2'
  });

  console.log(page.url());

  const stories = await page.evaluate('__STORYBOOK_CLIENT_API__.getStorybook()');
  let all = [];
  stories.forEach((story) => {
    const kind = story.kind;

    story.stories.forEach((view) => {
      const name = view.name;

      all.push({
        url: `selectedKind=${kind}&selectedStory=${name}`,
        kind,
        name
      });
    })
  });
  return all;
};

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if(totalHeight >= scrollHeight){
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
};

const createScreenshot = async (context, url, name) => {
  const page = await context.newPage();

  console.log(`loading ${url}`);

  await page.goto(url, {waitUntil: 'networkidle0'}).catch((e) => {
    console.log('error', e);
    core.setFailed(e);
  });

  await autoScroll(page);

  const base64Image = await page.screenshot({fullPage: true});
  const screenshot = Buffer.from(base64Image, 'base64');

  await page.close({runBeforeUnload: true});

  return screenshot;
};

const screenshotPage = async (page, url, name) => {
  await page.goto(url);
  const screenshot = await createScreenshot(page, name);

  return screenshot;
};

const chunk = (array, chunk_size) => Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size));

const getChromePath = () => {
  let browserPath;

  if (os.type() === "Windows_NT") {
    // Chrome is usually installed as a 32-bit application, on 64-bit systems it will have a different installation path.
    const programFiles = os.arch() === 'x64' ? process.env["PROGRAMFILES(X86)"] : process.env.PROGRAMFILES;
    browserPath = path.join(programFiles, "Google/Chrome/Application/chrome.exe");
  } else if (os.type() === "Linux") {
    browserPath = "/usr/bin/google-chrome";
  } else {
    browserPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  if (browserPath && browserPath.length > 0) {
    return path.normalize(browserPath);
  }

  throw new TypeError(`Cannot run action. ${os.type} is not supported.`);
}

module.exports.getChromePath = getChromePath;
module.exports.chunk = chunk;
module.exports.createScreenshot = createScreenshot;
module.exports.screenshotPage = screenshotPage;
module.exports.autoScroll = autoScroll;
module.exports.stories = getStories;
