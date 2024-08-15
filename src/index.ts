import { execSync } from 'child_process';
import fs from "fs";
import puppeteer from "puppeteer-extra";

import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

const MAX_LENGTH = 100; // characters
const DELAY_BETWEEN_ANSWERS = 600; // ms

const ANSWER_DATA_FILE = "answerData.json";

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

type AnswerData = {
    correctAnswerMap: [string, string][],
    incorrectAnswerMap: [string, string][]
};
if(!fs.existsSync(ANSWER_DATA_FILE)) {
    fs.writeFileSync(ANSWER_DATA_FILE, JSON.stringify({
        correctAnswerMap: [],
        incorrectAnswerMap: []
    } satisfies AnswerData));
}
const answerData: AnswerData = JSON.parse(fs.readFileSync(ANSWER_DATA_FILE).toString());
fs.cpSync(ANSWER_DATA_FILE, "answerDataBackup.json", { force: true });

function saveAnswerData() {
    fs.writeFileSync(ANSWER_DATA_FILE, JSON.stringify(answerData));
    console.log("Answer data saved to answerData.json");
}

function getPrompt(previousGuesses, currentGuess) {
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
function calculateAnswerOrder(startingAnswer: string, previousAnswers: string[]): string[] {
    const possibleAnswers = answerData.correctAnswerMap.filter(e => e[0] === startingAnswer).map(e => e[1]).filter(e => !previousAnswers.includes(e));

    let longestChain: string[] = [];
    for(const answer of possibleAnswers) {
        const chain = calculateAnswerOrder(answer, [...previousAnswers, startingAnswer]);
        if(chain.length > longestChain.length) {
            longestChain = chain;
        }
    }

    return [startingAnswer, ...longestChain];
}

let finalRun = process.argv[3] === "finalRun";
let answerOrder: string[] = [];
if(finalRun) {
    const startTime = Date.now();
    answerOrder = calculateAnswerOrder("rock", ["rock"]).slice(1); // We don't answer with "rock".
    console.log(`Preprocessed final run answer chain in ${Date.now() - startTime}ms.`);
    console.log(`Answer chain: ${answerOrder.join(" -> ")}`);
    console.log(`\n\n\n    Final answer chain predicted length: ${answerOrder.length}\n\n\n`);
    console.log("Starting final run in 2 seconds...");
    await new Promise(resolve => setTimeout(resolve, 2000));
}

async function getNextAnswer(previousGuesses, currentGuess) {
    if(finalRun) {
        const nextAnswer = answerOrder.shift();
        if(nextAnswer === undefined) {
            console.log("Final run preprocessed answer chain finished! Continuing with AI-generated answers.");
            finalRun = false;
        } else return nextAnswer;
    }

    const prompt = getPrompt(previousGuesses, currentGuess);
    console.log(`Prompt: ${prompt}`);

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
        output = execSync(`ollama run llama3.1 '${prompt.replace("'", '')}'`).toString().toLowerCase();
        output = output.split("\n")[0].trim();
    }

    console.log(`Answering with ${output}.`);

    return output;
}

async function run() {
    const page = await browser.newPage();
    
    page.on('load', async () => {
        if(await page.url() !== "https://www.whatbeatsrock.com/") {
            return;
        }
        console.log(await page.url());

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

        async function respond() {
            const previousAnswers = await getCorrectAnswerList();
            if(previousAnswers.length === 0) {
                console.log("No previous answers found. Only using 'rock'.");
            }

            const currentGuess = await getCurrentGuess();

            const nextAnswer = await getNextAnswer(previousAnswers, currentGuess);
            await page.locator(inputSelector).fill(nextAnswer);
            
            console.log(`Answer filled; submitting...`);

            await page.locator(goSelector).click();
            await Promise.race([
                page.waitForSelector(doesNotBeatSelector),
                page.waitForSelector(beatsSelector)
            ]);

            if(await page.$(doesNotBeatSelector) !== null) { // Failure
                const answers = await getCorrectAnswerList();
                console.log(`\x1b[1;31mIncorrectly answered ${currentGuess} with ${nextAnswer}.\x1b[0m Correct answer streak: \n    ${answers.join(" -> ")}`);

                if(answerData.correctAnswerMap.find(e => e[0] === currentGuess && e[1] === nextAnswer)) {
                    answerData.correctAnswerMap = answerData.correctAnswerMap.filter(e => e[0] !== currentGuess || e[1] !== nextAnswer);
                }
                answerData.incorrectAnswerMap.push([currentGuess, nextAnswer]);
                answerData.correctAnswerMap.push([nextAnswer, currentGuess]);
                saveAnswerData();

                await page.locator(playAgainSelector).click(); // The page will reload, which will run the load event and replay the game.
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
        }

        respond();
    });

    await page.goto('https://whatbeatsrock.com/');
    await page.setViewport({ width: 952, height: 958 });
}

run();