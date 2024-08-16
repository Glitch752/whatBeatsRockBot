import { execSync } from 'child_process';
import fs from "fs";
import puppeteer from "puppeteer-extra";

import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ANSWER_DATA_FILE, AnswerData } from './answerData';
puppeteer.use(StealthPlugin());

const MAX_LENGTH = 100; // characters
const DELAY_BETWEEN_ANSWERS = 2000; // ms

const DISALLOWED_PHRASES = [
    "would beat",
    "god",
    "because",
    "is better",
    "is stronger",
    "answering with",
    "is the best",
    "i choose",
    "i pick",
    "i select",
    "i answer"
];

if(!fs.existsSync(ANSWER_DATA_FILE)) {
    fs.writeFileSync(ANSWER_DATA_FILE, JSON.stringify({
        correctAnswerMap: [],
        incorrectAnswerMap: []
    } satisfies AnswerData));
}
const answerData: AnswerData = JSON.parse(fs.readFileSync(ANSWER_DATA_FILE).toString());
fs.cpSync(ANSWER_DATA_FILE, "answerDataBackup.json", { force: true });

function saveAnswerData() {
    // Deduplicate correctAnswerMap and incorrectAnswerMap
    answerData.correctAnswerMap = answerData.correctAnswerMap.filter((e, i) => answerData.correctAnswerMap.findIndex(f => f[0] === e[0] && f[1] === e[1]) === i);
    answerData.incorrectAnswerMap = answerData.incorrectAnswerMap.filter((e, i) => answerData.incorrectAnswerMap.findIndex(f => f[0] === e[0] && f[1] === e[1]) === i);

    fs.writeFileSync(ANSWER_DATA_FILE, JSON.stringify(answerData));
    console.log("Answer data saved to answerData.json");
}

function joinWithLast(arr: string[], lastWord: string) {
    return `${arr.slice(0, arr.length - 1).join(", ")}, ${lastWord} ${arr[arr.length - 1]}`;
}

function getPrompt(previousGuesses: string[], currentGuess: string, doNotAnswerWith: string[] = []) {
//     return `Determine an item or concept that would beat "${currentGuess}" \
// in an alternative, extreme, version of Rock Paper Scissors where any move can be made. \
// Be creative and do not repeat answers. Do not add punctuation to your answer. \
// Keep your answers relatively short, simple, and ensure you'll acquire a decisive win! \
// DO NOT answer with two concepts similar to each other, and do not answer with a concept that is a subset of another concept. \
// While your answer should beat "${currentGuess}" in this game, it should not be too similar to it. \
// Don't answer with a concept that is too broad or too specific. \

// Previous answers include ${previousGuesses.slice(0, previousGuesses.length - 1).map(e => `"${e}"`).join(" beating ")} beating "rock"; \

// DO NOT repeat these. As an example, "drought" could beat "water", and "rust" could beat "scissors". \
// Examples of answers that are too related are "event horizon" beating "black hole". \
// Stay away from answers that are so broad they could beat anything, like "god". \

// MOVE ANSWERS AWAY FROM CONCEPTS THAT HAVE ALREADY BEEN MOVED THROUGH. \
// MAKE ABSOLUTELY SURE TO KEEP YOUR ANSWER SHORT AND SIMPLE. \
// Answer with only the item or concept; do not add extra text. \

// What short response would decisively beat "${currentGuess}" in this game?`;
    return `Determine an item or concept that would beat "${currentGuess}" \
in an alternative, extreme, version of Rock Paper Scissors where any answer is valid. \
Be creative and do not repeat answers. Do not add punctuation to your answer. \
Keep your answers relatively short, simple, and ensure you'll acquire a decisive win! \
Previous answers include ${previousGuesses.slice(0, previousGuesses.length - 1).map(e => `"${e}"`).join(", ")}, and "rock"; \
DO NOT repeat these. As an example, "drought" could beat "water", and "rust" could beat "scissors". \
${doNotAnswerWith.length > 0 ? `DO NOT answer with ${joinWithLast(doNotAnswerWith.map(e => `"${e}"`), "or")}. ` : ""}\
Answer with only the item or concept; do not add extra text. \
What would beat "${currentGuess}" in this game?`;
}

const browserWSEndpoint = (await (await fetch("http://localhost:9222/json/version")).json()).webSocketDebuggerUrl;
if(browserWSEndpoint === undefined) {
    console.error("Failed to connect to browser. Make sure to run a Chromium browser instance with the --remote-debugging-port=9222 flag.");
    process.exit(1);
}

const browser = await puppeteer.connect({
    browserWSEndpoint
});

/**
 * Calculates the longest possible answer chain starting with the given answer.
 */
function calculateAnswerOrder(): string[] {
    // For performance, remove any nodes that don't have nodes pointing to them.
    const correctAnswerMap = answerData.correctAnswerMap.slice();
    let changed = true;
    while(changed) {
        changed = false;
        for(const answer of correctAnswerMap.map(e => e[1])) {
            if(!correctAnswerMap.some(e => e[0] === answer)) {
                correctAnswerMap.splice(correctAnswerMap.findIndex(e => e[1] === answer), 1);
                changed = true;
            }
        }
    }
    
    console.log("Correct answer map pruned.");

    return calculateAnswerOrderInner(correctAnswerMap, "rock", ["rock"]); // Starting with rock
}

const answerOrderCache: { [key: string]: string[] } = {};
function calculateAnswerOrderInner(correctAnswerMap: [string, string][], startingAnswer: string, previousAnswers: string[]): string[] {
    const cacheKey = startingAnswer;
    if(answerOrderCache[cacheKey]) {
        const cached = answerOrderCache[cacheKey];
        if(cached.filter(e => previousAnswers.includes(e)).length === 0) {
            return cached;
        }
    }

    const possibleAnswers = correctAnswerMap.filter(e => e[0] === startingAnswer).map(e => e[1]).filter(e => !previousAnswers.includes(e));

    let longestChain: string[] = [];
    for(const answer of possibleAnswers) {
        const chain = calculateAnswerOrderInner(correctAnswerMap, answer, [...previousAnswers, startingAnswer]);
        if(chain.length > longestChain.length) {
            longestChain = chain;
        }
    }

    answerOrderCache[cacheKey] = [startingAnswer, ...longestChain];
    return [startingAnswer, ...longestChain];
}

let finalRun = process.argv[2] === "finalRun";
let explorationMode = process.argv[2] === "explorationMode";

let answerOrder: string[] = [];
if(finalRun) {
    const startTime = Date.now();
    console.log("Starting final run; calculating longest answer chain...");
    answerOrder = calculateAnswerOrder().slice(1); // We don't answer with "rock".
    console.log(`Preprocessed final run answer chain in ${Date.now() - startTime}ms.`);
    console.log(`Answer chain: ${answerOrder.join(" -> ")}`);
    console.log(`\n\n\n    Final answer chain predicted length: ${answerOrder.length}\n\n\n`);
    console.log("Starting final run in 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * Gets the next answer to use.  
 * Returns null if the page should be reloaded (no answers could be found).  
 * @param previousGuesses 
 * @param currentGuess 
 * @returns 
 */
async function getNextAnswer(previousGuesses, currentGuess): Promise<string | null> {
    if(finalRun) {
        const nextAnswer = answerOrder.shift();
        if(nextAnswer === undefined) {
            console.log("Final run preprocessed answer chain finished! Continuing with AI-generated answers.");
            finalRun = false;
        } else return nextAnswer;
    }

    if(explorationMode) {
        // Pick a random known correct answer if any are available.
        // If not available, turn off exploration mode and continue with AI-generated answers.

        const knownCorrectAnswers = answerData.correctAnswerMap.filter(e => e[0] === currentGuess).map(e => e[1]).filter(e => !previousGuesses.includes(e));
        if(knownCorrectAnswers.length > 0) {
            const nextAnswer = knownCorrectAnswers[Math.floor(Math.random() * knownCorrectAnswers.length)];
            console.log(`Exploration mode enabled. Answering with known correct answer ${nextAnswer}.`);
            return nextAnswer;
        } else {
            console.log("Exploration mode enabled. No known correct answers found. Disabling exploration mode.");
            explorationMode = false;
        }
    }

    let prompt = getPrompt(previousGuesses, currentGuess);
    console.log(`Prompt: ${prompt}`);

    let doNotUseAnswers = [];

    let output, i = 1;
    while(
        output === undefined || // First iteration

        // Site checks
        previousGuesses.includes(output) || // "no repeats! try something else"
        output.length === 0 || // "type something"
        /\d/.test(output) || // "I'm bad at numbers"
        /"/.test(output) || // "pls no quotes lol"
        new RegExp(/(?:\uD83C[\uDDE6-\uDDFF])|(?:\uD83D[\uDC00-\uDE4F\uDE80-\uDEFF])|(?:\uD83E[\uDD00-\uDDFF])|[\u2600-\u27BF]|[\uD83C-\uDBFF\uDC00-\uDFFF]/g).test(output) || // "emoji?? \uD83E\uDEE0"
        output.length > 280 || // "280 chars max"
        new RegExp("___").test(output) || // "no funny business"

        // Out checks
        output.length > MAX_LENGTH ||
        answerData.correctAnswerMap.find(e => e[0] === currentGuess && e[1] === output) ||
        answerData.incorrectAnswerMap.find(e => e[0] === currentGuess && e[1] === output) ||
        DISALLOWED_PHRASES.some(e => output.includes(e))
    ) {
        console.log(`Generation attempt ${i++}`);
        if(i > 20) {
            console.error(`Failed to generate a new answer after 20 attempts. Latest answer: ${output}.`);
            // Pick a random known correct answer if any are available.
            const knownCorrectAnswers = answerData.correctAnswerMap.filter(e => e[0] === currentGuess).map(e => e[1]);
            if(knownCorrectAnswers.length > 0) {
                output = knownCorrectAnswers[Math.floor(Math.random() * knownCorrectAnswers.length)];
            } else {
                return null;
            }
        }

        if(i > 5) {
            doNotUseAnswers.push(output);
            prompt = getPrompt(previousGuesses, currentGuess, doNotUseAnswers);
        }

        output = execSync(`ollama run llama3.1 '${prompt.replace("'", '')}'`).toString().toLowerCase();
        output = output.split("\n")[0].trim();
    }

    console.log(`Answering with ${output}.`);

    return output;
}

let shouldWaitReasons = new Set<string>();
async function waitIfRequired() {
    while(shouldWaitReasons.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function run() {
    const page = await browser.newPage();

    let pageNotReloadTimeout: NodeJS.Timeout = null;
    page.on('load', async () => {
        if(pageNotReloadTimeout) {
            clearTimeout(pageNotReloadTimeout);
            pageNotReloadTimeout = null;
        }

        if(await page.url() !== "https://www.whatbeatsrock.com/") {
            if(await page.url().startsWith("https://www.whatbeatsrock.com/")) {
                console.log("Page loaded to a different path. Reloading...");
                await page.goto('https://whatbeatsrock.com/');
            }
            return;
        }

        const previousGuessSelector = "div.justify-start.relative > div:nth-child(6) > p";
        const currentGuessSelector = "div.justify-start.relative > p.text-2xl.text-center";
        const inputSelector = "input.pl-4";
        const doesNotBeatSelector = "div.relative > p.text-center.text-3xl.sm\\:text-5xl.pb-2.text-red-400";
        const beatsSelector = "p.text-2xl.sm\\:text-4xl.pb-2.text-green-400.text-center";
        const nextSelector = "div.flex-col > button.py-4";
        const goSelector = "div > form > button";
        const playAgainSelector = "div.flex.flex-row.gap-2.pt-4.pb-2 > button:nth-child(1)";

        async function getCorrectAnswerList() {
            return await page.evaluate(`
            (() => {
                const element = Array.from(document.querySelectorAll("p")).filter(e => (e.innerText.includes("😵") || e.innerText.includes("🤜")) && e.innerText.includes("rock"))[0];
                return element ? element.innerText.split(" 🤜 ").map(e => {
                    if(e.includes(" 😵 ")) {
                        return e.split(" 😵 ")[1];
                    } else {
                        return e;
                    }
                }) : ["rock"];
            })();`) as string[];
        }
        async function getCurrentGuess() {
            return await page.evaluate(`document.querySelector("${currentGuessSelector}").innerText.slice(0, -1).toLowerCase()`) as string;
        }

        const attemptReloadOnError = async () => {
            console.log("Error occurred. Reloading page and trying to continue in 3 seconds...");

            await waitIfRequired();

            let reloads = 0;
            const reload = async () => {
                if(pageNotReloadTimeout) clearTimeout(pageNotReloadTimeout);
                pageNotReloadTimeout = setTimeout(() => {
                    if(reloads++ >= 5) {
                        console.error("Page failed to reload after 5 attempts. Exiting.");
                        process.exit(1);
                    }
                    
                    console.error("Page failed to reload after 5 seconds. Trying again in 10 seconds.");
                    setTimeout(reload, 10000);
                }, 5000);
                await page.reload();
            };
            setTimeout(reload, 3000);
        }

        async function respond() {
            try {
                const previousAnswers = await getCorrectAnswerList();
                if(previousAnswers.length === 0) {
                    console.log("No previous answers found. Only using 'rock'.");
                }

                const currentGuess = await getCurrentGuess();

                let nextAnswer = await getNextAnswer(previousAnswers, currentGuess);

                if(nextAnswer === null) {
                    if(currentGuess === "rock") {
                        console.log("No more chains could be found stemming from rock! Entering exploration mode.");
                        explorationMode = true;
                        nextAnswer = await getNextAnswer(previousAnswers, currentGuess);
                        if(nextAnswer === null) {
                            console.log("No answer could be found after enabling exploration mode. Reloading page.");
                            attemptReloadOnError();
                            return;
                        }
                    } else {
                        console.log("No answer could be found. Reloading page.");
                        attemptReloadOnError();
                        return;
                    }
                }

                await page.locator(inputSelector).fill(nextAnswer);
                
                console.log(`Answer filled; submitting...`);

                await waitIfRequired();
                await page.locator(goSelector).click();
                await Promise.race([
                    page.waitForSelector(doesNotBeatSelector),
                    page.waitForSelector(beatsSelector)
                ]);

                if(await page.$(doesNotBeatSelector) !== null) { // Failure
                    const answers = await getCorrectAnswerList();
                    console.log(`\x1b[1;31mIncorrectly answered ${currentGuess} with ${nextAnswer}.\x1b[0m Correct answer streak: \n    ${answers.join(" -> ")}`);

                    if(finalRun) {
                        console.log(`Final run finished with a length of ${answers.length}. Exiting.`);
                        process.exit(0);
                    }

                    if(answerData.correctAnswerMap.find(e => e[0] === currentGuess && e[1] === nextAnswer)) {
                        answerData.correctAnswerMap = answerData.correctAnswerMap.filter(e => e[0] !== currentGuess || e[1] !== nextAnswer);
                    }
                    answerData.incorrectAnswerMap.push([currentGuess, nextAnswer]);
                    answerData.correctAnswerMap.push([nextAnswer, currentGuess]);
                    saveAnswerData();

                    let reloads = 0;
                    const clickPlayAgain = async () => {
                        try {
                            await page.locator(playAgainSelector).click(); // The page will reload, which will run the load event and replay the game.
                            if(pageNotReloadTimeout) clearTimeout(pageNotReloadTimeout);
                            pageNotReloadTimeout = setTimeout(clickPlayAgain, 500); // In case the page doesn't reload, keep trying until it does.

                            if(reloads++ >= 5) console.log(`Failed to click play again after ${reloads} attempts. Continuing to try.`);
                        } catch(e) {
                            console.error(e);
                            attemptReloadOnError();
                        }
                    };
                    await clickPlayAgain();
                } else { // Success
                    const answers = await getCorrectAnswerList();
                    console.log(`\x1b[1;32mSuccessfully answered ${currentGuess} with ${nextAnswer}!\x1b[0m Correct answer streak: \n    ${answers.join(" -> ")}`);

                    if(answerData.incorrectAnswerMap.find(e => e[0] === currentGuess && e[1] === nextAnswer)) {
                        answerData.incorrectAnswerMap = answerData.incorrectAnswerMap.filter(e => e[0] !== currentGuess || e[1] !== nextAnswer);
                    }
                    answerData.correctAnswerMap.push([currentGuess, nextAnswer]);
                    answerData.incorrectAnswerMap.push([nextAnswer, currentGuess]);
                    saveAnswerData();

                    await page.locator(nextSelector).click();
                    setTimeout(respond, DELAY_BETWEEN_ANSWERS);
                }
            } catch(e) {
                console.error(e);
                attemptReloadOnError();
            }
        }

        respond();
    });

    page.on('dialog', async dialog => {
        console.log('Got dialog');

        shouldWaitReasons.add(dialog.message());
        
        if(dialog.message().includes("rate limit")) {
            console.log("\x1b[1;31mHit rate limit! Waiting 10 minutes and trying again.\x1b[0m");
            await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 10));
        }

        shouldWaitReasons.delete(dialog.message());

        await dialog.accept();
    });      

    await page.goto('https://whatbeatsrock.com/');
    await page.setViewport({ width: 952, height: 2000 });
}

run();