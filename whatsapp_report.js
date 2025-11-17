#!/usr/bin/env node
/**
 * whatsapp_report.js
 *
 * Usage:
 *   node whatsapp_report.js [path-to-chat-txt] [--verbose]
 *
 * Produces:
 *   - report.html (visualizations, fully offline)
 *
 * Requires:
 *   npm install emoji-regex chart.js
 */

const fs = require('fs');
const path = require('path');
const emojiRegex = require('emoji-regex');
// SQLite export removed

// ---------------------- Config / editable arrays ----------------------
const stopWords = [
    "de", "het", "een", "en", "van", "ik", "je", "jij", "u", "hij", "zij", "ze", "wij", "we", "jullie", "hen", "hun",
    "dit", "dat", "die", "deze", "daar", "hier", "er", "maar", "als", "dan", "toen", "omdat", "terwijl", "want",
    "niet", "geen", "niets", "alles", "iets",
    "is", "was", "ben", "zijn", "waren", "word", "wordt", "werd", "werden", "heb", "hebt", "heeft", "hebben", "had", "hadden",
    "doe", "doet", "doen", "maakte", "maak", "maakt", "maken",
    "kan", "kunt", "kunnen", "kon", "konden",
    "zal", "zult", "zullen", "zou", "zouden",
    "moet", "moeten", "moest", "moesten",
    "mag", "mogen", "mocht", "mochten",
    "bij", "naar", "vanuit", "voor", "achter", "onder", "boven", "met", "zonder", "tegen", "over", "tussen", "naast",
    "in", "op", "aan", "tot", "uit", "over", "door", "om", "rond",
    "mijn", "jouw", "zijn", "haar", "ons", "onze", "hun",
    "ja", "nee", "ah", "oh", "uh", "eh", "hmm", "haha", "lol",
    "te", "al", "nog", "wel", "ook", "dus", "alweer", "weer", "eens", "toch", "zelf", "zelfs",
    "weinig", "meer", "minder", "meeste",
    "wie", "wat", "waar", "wanneer", "hoe", "waarom",
    "ieder", "iedere", "elk", "elke", "sommige", "soms",
    "heel", "hele", "ander", "andere",
    "binnen", "buiten", "altijd", "nooit", "vaak", "snel", "even",
    "misschien", "inderdaad", "gewoon", "natuurlijk", "eigenlijk",
    "ok", "oke", "oké", "jaaa", "neehee",
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "10",
    "t", "i", "ga", "of", "mn", "m'n", "m", "https", "it", "ie", "a", "n",
    "message", "deleted", "this", "you", "the", "was", "media", "omitted", "votes", "poll", "option",
    "afbeelding", "weggelaten"
];
const customFilterWords = [];
const FILTER_WORDS = new Set([...stopWords, ...customFilterWords].map(w => w.toLowerCase()));

// ---------------------- Helper regex / parsers ----------------------
// Supported line starts:
// 1) 13/10/2019, 03:35 - Name: message
// 2) [22-04-2022, 12:26:14] Name: message
const lineStartRe = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2})\s*-\s*/;
const lineStartBracketRe = /^\[(\d{1,2})-(\d{1,2})-(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*/;
const senderSplitRe = /^(.*?):\s*(.*)$/;
const wordTokenRe = /[A-Za-zÀ-ÖØ-öø-ÿ0-9_']+/g;
const emoji_re = emojiRegex();

// ---------------------- Utility functions ----------------------
function parseDateTime(dateStr, timeStr) {
    const [d, m, y] = dateStr.split('/').map(s => parseInt(s, 10));
    const year = (y < 100) ? (2000 + y) : y;
    const [hour, minute] = timeStr.split(':').map(Number);
    return new Date(year, m - 1, d, hour, minute, 0, 0);
}
function parseDateTimeBracket(d, m, y, hh, mm, ss) {
  const year = (y < 100) ? (2000 + y) : y;
  const sec = Number.isFinite(ss) ? ss : 0;
  return new Date(year, m - 1, d, hh, mm, sec, 0);
}

function tokenizeWords(text) {
    const arr = [];
    const m = text.match(wordTokenRe);
    if (!m) return arr;
    for (const w of m) {
        const lw = w.toLowerCase();
        if (!FILTER_WORDS.has(lw)) arr.push(lw);
    }
    return arr;
}

function extractEmojis(text) {
    const re = emojiRegex();
    const out = [];
    let match;
    while ((match = re.exec(text)) !== null) {
        out.push(match[0]);
    }
    return out;
}

function minutesBetween(a, b) {
    return (a - b) / (1000 * 60);
}

// ---------------------- Main processing ----------------------
async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        console.error('Usage: node whatsapp_report.js path/to/chat.txt [--nodb] [--verbose]');
        process.exit(1);
    }
    const chatPath = argv[0];
    const verbose = argv.includes('--verbose') || process.env.WHATSAPP_REPORT_VERBOSE === '1';
    // Optional: identify "me" to attribute system lines like "You deleted this message"
    let meName = null;
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--me' && argv[i + 1]) { meName = argv[i + 1]; break; }
        const m = argv[i].match(/^--me=(.*)$/);
        if (m) { meName = m[1]; break; }
    }

    const vlog = (...args) => { if (verbose) console.log('[verbose]', ...args); };
    const ilog = (...args) => console.log('[info]', ...args);

    if (!fs.existsSync(chatPath)) {
        console.error('File not found:', chatPath);
        process.exit(1);
    }

    try {
        const st = fs.statSync(chatPath);
        ilog('Starting WhatsApp report generation');
        ilog('Input file:', chatPath);
        ilog('Input size:', st.size.toLocaleString(), 'bytes');
        ilog('Options:', JSON.stringify({ verbose, me: meName || undefined }));
    } catch (e) { }

    const raw = fs.readFileSync(chatPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    ilog('Scanned text into lines:', lines.length.toLocaleString());

    const messages = [];
    let current = null;
    let continuationLines = 0;
    let systemLines = 0;
    let malformedStarts = 0;
    const sendersSet = new Set();
    for (const line of lines) {
        if (!line) {
            if (current) { current.text += '\n'; continuationLines++; }
            continue;
        }
      const m = line.match(lineStartRe);
      const b = m ? null : line.match(lineStartBracketRe);
      if (m || b) {
        let timestamp, timeStr, rest;
        if (m) {
          const dateStr = m[1];
          timeStr = m[2];
          rest = line.slice(m[0].length);
          timestamp = parseDateTime(dateStr, timeStr);
        } else if (b) {
          const d = parseInt(b[1], 10);
          const mo = parseInt(b[2], 10);
          const y = parseInt(b[3], 10);
          const hh = parseInt(b[4], 10);
          const mm = parseInt(b[5], 10);
          const ss = b[6] != null ? parseInt(b[6], 10) : 0;
          timestamp = parseDateTimeBracket(d, mo, y, hh, mm, ss);
          timeStr = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
          rest = line.slice(b[0].length);
        }

        let sender = 'system';
        let text = rest;

        const s = rest.match(senderSplitRe);
        if (s) {
          sender = s[1].trim();
          if (meName && sender.toLowerCase() === 'you') sender = meName;
          text = s[2] || '';
        } else {
          sender = 'system';
          systemLines++;
        }
        if (current) messages.push(current);

        current = {
          id: messages.length,
          timestamp,
          date: timestamp.toISOString().slice(0, 10),
          time: timeStr,
          hour: timestamp.getHours(),
          sender,
          text: text,
          length: text.length
        };
        sendersSet.add(sender);
      } else {
            if (current) {
                current.text += '\n' + line;
                current.length = current.text.length;
                continuationLines++;
            } else {
                current = {
                    id: messages.length,
                    timestamp: new Date(),
                    date: new Date().toISOString().slice(0, 10),
                    time: '00:00',
                    hour: 0,
                    sender: 'system',
                    text: line,
                    length: line.length
                };
                systemLines++;
                malformedStarts++;
            }
        }
    }
    if (current) messages.push(current);

    ilog('Parsed messages:', messages.length.toLocaleString());
    vlog('Continuation lines merged:', continuationLines.toLocaleString());
    vlog('System/unsent lines:', systemLines.toLocaleString());
    vlog('Malformed start fallbacks:', malformedStarts.toLocaleString());
    vlog('Detected senders:', Array.from(sendersSet).join(', ') || '(none)');

    let totalWordTokens = 0;
    let totalEmojisExtracted = 0;
    for (const msg of messages) {
        msg.wordTokens = tokenizeWords(msg.text);
        msg.emojis = extractEmojis(msg.text);
        totalWordTokens += msg.wordTokens.length;
        totalEmojisExtracted += msg.emojis.length;
    }
    ilog('Tokenization complete:', totalWordTokens.toLocaleString(), 'word tokens,', totalEmojisExtracted.toLocaleString(), 'emojis');


    ilog('SQLite export disabled.');

    const persons = {};
    const wordFreq = new Map();
    const emojiFreq = new Map();
    const messagesPerDay = new Map();
    const messagesPerHour = new Array(24).fill(0);
    const messagesPerWeekday = new Array(7).fill(0); // 0=Sun..6=Sat
    const messagesPerMonth = new Map(); // 'YYYY-MM' -> count
    const lengthHistogramBins = [20, 50, 100, 200, 500];
    const lengthHistogram = new Array(lengthHistogramBins.length + 1).fill(0);
    const specialMessageStats = {
        mediaOmitted: 0,
        deleted: 0,
        linkOnly: 0,
        perPerson: {}
    };
    let totalMessages = 0;

    for (const msg of messages) {
        if (!persons[msg.sender]) {
            persons[msg.sender] = { count: 0, totalLength: 0, wordFreq: new Map(), emojiFreq: new Map(), replyTimes: [] };
        }
    }

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        totalMessages++;
        messagesPerDay.set(m.date, (messagesPerDay.get(m.date) || 0) + 1);
        if (typeof m.hour === 'number') messagesPerHour[m.hour]++;
        const d = m.timestamp;
        if (d instanceof Date && !isNaN(d)) {
            messagesPerWeekday[d.getDay()]++;
            const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            messagesPerMonth.set(ym, (messagesPerMonth.get(ym) || 0) + 1);
        }
        // length histogram
        const L = m.length || 0;
        let binIdx = lengthHistogramBins.findIndex(b => L <= b);
        if (binIdx === -1) binIdx = lengthHistogramBins.length; // overflow bin
        lengthHistogram[binIdx]++;

        const p = persons[m.sender];
        p.count++;
        p.totalLength += m.length;

        // Special message classification
        const t = (m.text || '').trim();
        const tl = t.toLowerCase();
        const senderName = m.sender;
        if (!specialMessageStats.perPerson[senderName]) {
            specialMessageStats.perPerson[senderName] = { mediaOmitted: 0, deleted: 0, linkOnly: 0 };
        }
        let isSpecial = false;
        if (/<\s*media\s+omitted\s*>/i.test(t)) {
            specialMessageStats.mediaOmitted++;
            specialMessageStats.perPerson[senderName].mediaOmitted++;
            isSpecial = true;
        } else if ((/\bdeleted\b/i.test(t) && /\bmessage\b/i.test(t)) || tl === 'this message was deleted' || tl === 'you deleted this message') {
            // Robust deleted detection: count any line indicating a deleted message
            specialMessageStats.deleted++;
            let whoDeleted = senderName;
            if (whoDeleted === 'system') {
                // Try to infer from text when sender is system
                const mYou = /^you deleted this message$/i.test(t);
                const mName = t.match(/^(.*) deleted this message$/i);
                if (mYou) {
                    whoDeleted = meName || 'You';
                } else if (mName && mName[1]) {
                    whoDeleted = mName[1].trim();
                }
            }
            if (!specialMessageStats.perPerson[whoDeleted]) {
                specialMessageStats.perPerson[whoDeleted] = { mediaOmitted: 0, deleted: 0, linkOnly: 0 };
            }
            specialMessageStats.perPerson[whoDeleted].deleted++;
            isSpecial = true;
        } else if (/^https?:\/\/\S+$/i.test(t)) {
            specialMessageStats.linkOnly++;
            specialMessageStats.perPerson[senderName].linkOnly++;
            isSpecial = true;
        }

        // Tokenization contributions: skip special messages from word stats
        for (const w of (isSpecial ? [] : m.wordTokens)) {
            wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
            p.wordFreq.set(w, (p.wordFreq.get(w) || 0) + 1);
        }
        for (const e of m.emojis) {
            emojiFreq.set(e, (emojiFreq.get(e) || 0) + 1);
            p.emojiFreq.set(e, (p.emojiFreq.get(e) || 0) + 1);
        }

        if (i > 0) {
            const prev = messages[i - 1];
            if (prev.sender !== m.sender) {
                const mins = minutesBetween(m.timestamp, prev.timestamp);
                if (Number.isFinite(mins) && mins >= 0) {
                    persons[m.sender].replyTimes.push(mins);
                }
            }
        }
    }

    ilog('Aggregation complete:');
    ilog('- Total messages:', totalMessages.toLocaleString());
    ilog('- Distinct days:', messagesPerDay.size.toLocaleString());
    ilog('- Unique senders:', Object.keys(persons).length.toLocaleString());

    const wordFreqArr = Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1]);
    const top100Words = wordFreqArr.slice(0, 100);

    let maxDay = null;
    for (const [date, cnt] of messagesPerDay.entries()) {
        if (!maxDay || cnt > maxDay.count) maxDay = { date, count: cnt };
    }
    const distinctDays = messagesPerDay.size;
    const avgMessagesPerDay = distinctDays ? (totalMessages / distinctDays) : 0;

    const emojiArr = Array.from(emojiFreq.entries()).sort((a, b) => b[1] - a[1]);
    const distinctEmojiCount = emojiArr.length;
    const mostCommonEmoji = emojiArr.length ? emojiArr[0] : [null, 0];

    vlog('Distinct words:', wordFreqArr.length.toLocaleString());
    vlog('Distinct emojis:', distinctEmojiCount.toLocaleString());
    if (top100Words.length) {
        vlog('Top words sample:', top100Words.slice(0, 5).map(([w, c]) => w + ':' + c).join(', '));
    }

    const perPersonSummary = {};
    for (const [name, stats] of Object.entries(persons)) {
        const wA = Array.from(stats.wordFreq.entries()).sort((a, b) => b[1] - a[1]);
        const eA = Array.from(stats.emojiFreq.entries()).sort((a, b) => b[1] - a[1]);
        const avgLen = stats.count ? (stats.totalLength / stats.count) : 0;
        const replyTimes = stats.replyTimes.slice().sort((a, b) => a - b);
        const meanReply = replyTimes.length ? (replyTimes.reduce((s, x) => s + x, 0) / replyTimes.length) : null;
        const medianReply = replyTimes.length ? (replyTimes.length % 2 ? replyTimes[(replyTimes.length - 1) / 2] : (replyTimes[replyTimes.length / 2 - 1] + replyTimes[replyTimes.length / 2]) / 2) : null;
        // Alternative reply-time metrics
        const excludeOvernight = replyTimes.filter(x => x <= 6 * 60);
        const meanExcludingOvernight = excludeOvernight.length ? (excludeOvernight.reduce((s, x) => s + x, 0) / excludeOvernight.length) : null;
        // Trimmed mean: drop top 10%
        let trimmedMean = null;
        if (replyTimes.length > 0) {
            const cut = Math.floor(replyTimes.length * 0.9);
            const kept = replyTimes.slice(0, Math.max(1, cut));
            trimmedMean = kept.reduce((s, x) => s + x, 0) / kept.length;
        }
        // p90
        const p90 = replyTimes.length ? replyTimes[Math.floor(0.9 * (replyTimes.length - 1))] : null;
        // geometric mean (in minutes), add epsilon to avoid log(0)
        let geometricMean = null;
        if (replyTimes.length > 0) {
            const eps = 0.1;
            const sumLog = replyTimes.reduce((s, x) => s + Math.log(x + eps), 0);
            geometricMean = Math.exp(sumLog / replyTimes.length) - eps;
        }

        perPersonSummary[name] = {
            count: stats.count,
            avgLength: avgLen,
            topWords: wA.slice(0, 50),
            topEmojis: eA.slice(0, 50),
            meanReplyMinutes: meanReply,
            medianReplyMinutes: medianReply,
            meanExclOvernightMinutes: meanExcludingOvernight,
            trimmedMeanMinutes: trimmedMean,
            p90ReplyMinutes: p90,
            geometricMeanMinutes: geometricMean,
            totalEmojis: eA.reduce((s, kv) => s + kv[1], 0)
        };
    }

    const personsList = Object.keys(perPersonSummary).filter(p => p !== 'system');
    let longestAvgPerson = null;
    for (const p of personsList) {
        if (!longestAvgPerson || perPersonSummary[p].avgLength > perPersonSummary[longestAvgPerson].avgLength) {
            longestAvgPerson = p;
        }
    }

    const messagesPerPerson = {};
    for (const p of personsList) messagesPerPerson[p] = perPersonSummary[p].count;

    // Build per-person counts for top100 words to enable clickable breakdowns
    const top100Set = new Set(top100Words.map(([w]) => w));
    const topWordsPerPersonCounts = {}; // word -> { person -> count }
    for (const msg of messages) {
        // Skip special messages from breakdowns
        const t = (msg.text || '').trim();
        if (/<\s*media\s+omitted\s*>/i.test(t) ||
            /^https?:\/\/\S+$/i.test(t) ||
            t.toLowerCase() === 'you deleted this message' ||
            t.toLowerCase() === 'this message was deleted') {
            continue;
        }
        const who = msg.sender;
        for (const w of msg.wordTokens || []) {
            if (!top100Set.has(w)) continue;
            if (!topWordsPerPersonCounts[w]) topWordsPerPersonCounts[w] = {};
            topWordsPerPersonCounts[w][who] = (topWordsPerPersonCounts[w][who] || 0) + 1;
        }
    }

    // (Sentiment removed)

    // Longest consecutive-day streak and inactivity gaps
    function parseYMD(yymmdd) { const [Y, M, D] = yymmdd.split('-').map(Number); return new Date(Date.UTC(Y, M - 1, D)); }
    const dayKeysSorted = Array.from(messagesPerDay.keys()).sort();
    let bestLen = 0, bestStart = null, bestEnd = null;
    let curLen = 0, curStart = null, prevDate = null;
    for (const d of dayKeysSorted) {
        const dt = parseYMD(d);
        if (!prevDate) { curLen = 1; curStart = d; }
        else {
            const diffDays = (dt - prevDate) / (24 * 60 * 60 * 1000);
            if (diffDays === 1) curLen += 1; else { if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; bestEnd = dayKeysSorted[dayKeysSorted.indexOf(d) - 1]; } curLen = 1; curStart = d; }
        }
        prevDate = dt;
    }
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; bestEnd = dayKeysSorted.length ? dayKeysSorted[dayKeysSorted.length - 1] : null; }

    let longestGap = { minutes: 0, startTs: null, endTs: null, breaker: null };
    let longestGapUnderWeek = { minutes: 0, startTs: null, endTs: null, breaker: null };
    const silenceBreakers = {};
    const silenceThresholdMin = 24 * 60;
    for (let i = 1; i < messages.length; i++) {
        const prev = messages[i - 1];
        const cur = messages[i];
        const mins = minutesBetween(cur.timestamp, prev.timestamp);
        if (Number.isFinite(mins) && mins > longestGap.minutes) {
            longestGap = { minutes: mins, startTs: prev.timestamp.getTime(), endTs: cur.timestamp.getTime(), breaker: cur.sender };
        }
        if (Number.isFinite(mins) && mins <= 7 * 24 * 60 && mins > longestGapUnderWeek.minutes) {
            longestGapUnderWeek = { minutes: mins, startTs: prev.timestamp.getTime(), endTs: cur.timestamp.getTime(), breaker: cur.sender };
        }
        if (Number.isFinite(mins) && mins >= silenceThresholdMin) {
            silenceBreakers[cur.sender] = (silenceBreakers[cur.sender] || 0) + 1;
        }
    }

    // TF-IDF characteristic words per person (excluding 'system')
    const participantNames = Object.keys(persons).filter(n => n !== 'system');
    const N_part = participantNames.length || 1;
    const df = new Map();
    const totalsPerPerson = {};
    for (const name of participantNames) {
        let total = 0;
        for (const [, c] of persons[name].wordFreq.entries()) total += c;
        totalsPerPerson[name] = total || 1;
        for (const [w, c] of persons[name].wordFreq.entries()) {
            if (!c) continue;
            df.set(w, (df.get(w) || 0) + 1);
        }
    }
    const tfidfTopWords = {};
    for (const name of participantNames) {
        const arr = [];
        for (const [w, c] of persons[name].wordFreq.entries()) {
            if (!c) continue;
            const tf = c / (totalsPerPerson[name] || 1);
            const d = df.get(w) || 1;
            const idf = Math.log(N_part / d);
            const score = tf * idf;
            arr.push([w, score]);
        }
        arr.sort((a, b) => b[1] - a[1]);
        tfidfTopWords[name] = arr.slice(0, 30);
    }

    // First/Last message of shifted day (cutoff at 04:00)
    const dayCutoffHour = 4;
    const firstOfDayCounts = {};
    const lastOfDayCounts = {};
    const dayFirstLast = new Map();
    for (const m of messages) {
        const shifted = new Date(m.timestamp.getTime() - dayCutoffHour * 60 * 60 * 1000);
        const key = shifted.toISOString().slice(0, 10);
        if (!dayFirstLast.has(key)) dayFirstLast.set(key, { first: m.sender, last: m.sender });
        else dayFirstLast.get(key).last = m.sender;
    }
    for (const { first, last } of dayFirstLast.values()) {
        if (first && first !== 'system') firstOfDayCounts[first] = (firstOfDayCounts[first] || 0) + 1;
        if (last && last !== 'system') lastOfDayCounts[last] = (lastOfDayCounts[last] || 0) + 1;
    }

    const output = {
        meta: { totalMessages, distinctDays, avgMessagesPerDay, maxDay, distinctEmojiCount, mostCommonEmoji, meName },
        top100Words,
        // Provide full word counts for client-side filtering without reload
        globalWordCounts: Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1]),
        perPersonWordCounts: Object.fromEntries(
            Object.entries(persons).map(([name, stats]) => [name, Array.from(stats.wordFreq.entries())])
        ),
        defaultFilterWords: Array.from(FILTER_WORDS),
        messagesPerHour,
        messagesPerDay: Array.from(messagesPerDay.entries()).sort(),
        messagesPerWeekday,
        messagesPerMonth: Array.from(messagesPerMonth.entries()).sort(),
        lengthHistogram: { bins: lengthHistogramBins, counts: lengthHistogram },
        emojiArr,
        perPersonSummary,
        messagesPerPerson,
        longestAvgPerson,
        specialMessageStats,
        topWordsPerPersonCounts,
        longestStreak: { start: bestStart, end: bestEnd, lengthDays: bestLen },
        longestGap,
        longestGapUnderWeek,
        silenceBreakers,
        tfidfTopWords,
        firstOfDayCounts,
        lastOfDayCounts,
        dayCutoffHour
    };

    let chartJsBundle = '';
    try {
        const chartJsPath = require.resolve('chart.js/dist/chart.umd.js');
        chartJsBundle = fs.readFileSync(chartJsPath, 'utf8');
        vlog('Chart.js inlined from', chartJsPath, '(' + chartJsBundle.length.toLocaleString() + ' bytes)');
    } catch (e) {
        console.warn('Could not inline Chart.js. Ensure chart.js is installed. Error:', e.message);
    }

    const html = buildHtmlReport(output, chartJsBundle);
    const outPath = path.join(process.cwd(), 'report.html');
    fs.writeFileSync(outPath, html, 'utf8');
    try {
        const st = fs.statSync(outPath);
        ilog('Report written:', outPath, '(' + st.size.toLocaleString() + ' bytes)');
    } catch (e) {
        ilog('Report written to', outPath);
    }
    console.log('Open report.html in your browser (offline, no internet required).');
}

// ---------------------- HTML report builder ----------------------
function buildHtmlReport(output, chartJsBundle) {
    const DATA = output;
    const title = 'WhatsApp Chat Report';
    const css = `
    /* Theme variables */
    :root {
      --bg: #f7f7fb;
      --bg-accent: transparent;
      --card-bg: #ffffff;
      --text: #222222;
      --muted: #666666;
      --border: #eaeaea;
      --chip-bg: #fafafa;
      --chip-border: #dddddd;
      --chip-text: #333333;
      --accent: #6ea8fe; /* default professional accent */
      --shadow: 0 4px 18px rgba(0,0,0,0.06);
      --radius: 12px;
    }
    body.theme-couple {
      --bg: #fff7fb;
      --bg-accent: linear-gradient(180deg, rgba(255,192,203,0.20) 0%, rgba(255,255,255,0) 50%), radial-gradient(600px 400px at 85% -10%, rgba(255,179,186,0.28) 0%, rgba(255,255,255,0) 60%), radial-gradient(600px 400px at -10% 20%, rgba(255,223,186,0.25) 0%, rgba(255,255,255,0) 60%);
      --card-bg: #ffffff;
      --text: #2b1e23;
      --muted: #70565f;
      --border: #f3dde3;
      --chip-bg: #fff0f5;
      --chip-border: #f6cada;
      --chip-text: #5a3a44;
      --accent: #ff7aa2; /* romantic accent */
      --shadow: 0 10px 24px rgba(255,122,162,0.15);
      --radius: 14px;
    }
    body.theme-group {
      --bg: #f6f8fb;
      --bg-accent: linear-gradient(180deg, rgba(110,168,254,0.08) 0%, rgba(255,255,255,0) 60%);
      --card-bg: #ffffff;
      --text: #1f2a37;
      --muted: #5b6676;
      --border: #e5e7eb;
      --chip-bg: #f3f4f6;
      --chip-border: #e5e7eb;
      --chip-text: #1f2a37;
      --accent: #2563eb; /* professional accent */
      --shadow: 0 8px 22px rgba(37,99,235,0.10);
      --radius: 12px;
    }

    body { font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; margin: 16px; color: var(--text); background: var(--bg); background-image: var(--bg-accent); background-attachment: fixed; }
    /* Centered container at ~80% width */
    body > header, body > main, body > footer { width: 80%; max-width: 1400px; margin: 0 auto; }
    @media (max-width: 980px) { body > header, body > main, body > footer { width: 94%; } }
    header { display:flex; gap:16px; align-items:center; }
    h1 { margin: 0 0 8px 0; font-size: 28px; letter-spacing: 0.2px; }
    body.theme-couple h1 { background: linear-gradient(90deg, var(--accent), #ffb3c1); -webkit-background-clip: text; background-clip: text; color: transparent; }
    body.theme-group h1 { color: var(--text); }
    .grid2 { display:grid; grid-template-columns: repeat(2, minmax(360px,1fr)); gap: 18px; margin-top: 16px; }
    .grid3 { display:grid; grid-template-columns: repeat(3, minmax(280px,1fr)); gap: 18px; margin-top: 16px; }
    .card { background: var(--card-bg); border-radius: var(--radius); padding: 14px; box-shadow: var(--shadow); border: 1px solid var(--border); }
    .card.full { grid-column: 1 / -1; }
    .span2 { grid-column: span 2; }
    canvas { width:100% !important; height:360px !important; }
    /* Make pies square and smaller to avoid looking massive */
    canvas.pieCanvas { width:260px !important; height:260px !important; max-width:100% !important; display:block; margin:auto; }
    table { width:100%; border-collapse: collapse; margin-top:8px; }
    th, td { text-align:left; padding:6px 8px; border-bottom: 1px solid var(--border); font-size: 13px; }
    .small { font-size: 12px; color: var(--muted); }
    .row { display:flex; gap:12px; align-items:center; }
    .center { text-align:center; }
    .controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
    .chip { border: 1px solid var(--chip-border); padding:6px 8px; border-radius:999px; background: var(--chip-bg); color: var(--chip-text); cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
    .chip .x { font-weight:700; cursor:pointer; color: var(--accent); }
    .muted { color: var(--muted); font-size:13px; }
    .chartRow { display:flex; align-items:flex-start; gap:12px; }
    .legendList { font-size:20px; line-height:1.3; max-height:320px; overflow:auto; min-width:180px; }
    .legendItem { display:flex; align-items:center; gap:6px; margin:2px 0; }
    .swatch { width:10px; height:10px; border-radius:2px; display:inline-block; }
    .collapsible { max-height: 0; overflow: hidden; transition: max-height 0.2s ease; }
    .collapsible.open { max-height: 220px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: var(--chip-bg); }
    #toggleExcludedBtn { font-size: 12px; }
    .topEmojiGrid { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 8px; }
    .topEmojiGrid > div { padding:6px 8px; border:1px solid var(--border); border-radius: 8px; background: var(--card-bg); }
    body.theme-couple .topEmojiGrid > div strong { color: var(--accent); }
    body.theme-group .topEmojiGrid > div strong { color: var(--accent); }
    /* Flexible card layout for tall content */
    .card-flex { display:flex; flex-direction: column; }
    .wordsScroll { flex: 1 1 auto; max-height: min(520px, 80vh); overflow: auto; }
    body.theme-couple h1::after { content: ' ❤'; font-size: 0.9em; color: var(--accent); margin-left:6px; }
    @media (max-width: 980px) {
      .grid2 { grid-template-columns: 1fr; }
      .grid3 { grid-template-columns: repeat(2, minmax(220px,1fr)); }
      canvas.pieCanvas { width:220px !important; height:220px !important; }
    }
    @media (max-width: 680px) {
      .grid3 { grid-template-columns: 1fr; }
      canvas.pieCanvas { width:200px !important; height:200px !important; }
    }
  `;
    // Important: escape sequences that could break the inline <script> tag
    // e.g. messages containing </script> must not terminate the script block.
    const dataJson = JSON.stringify(DATA)
        .replace(/<\//g, '<\\/')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${css}</style>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <header>
    <div>
      <h1>${title}</h1>
    </div>
  </header>

  <main>
    <div class="grid3">
    <section class="card">
      <h3>Summary</h3>
      <div><strong>Total messages:</strong> <span id="totalMessages"></span></div>
      <div><strong>Distinct days:</strong> <span id="distinctDays"></span></div>
      <div><strong>Average messages/day:</strong> <span id="avgPerDay"></span></div>
      <div><strong>Day with most messages:</strong> <span id="maxDay"></span></div>
      <div><strong>Distinct emojis used (global):</strong> <span id="distinctEmojiCount"></span></div>
      <div><strong>Most common emoji (global):</strong> <span id="mostCommonEmoji"></span></div>
    </section>

    <section class="card span2">
      <h3>Messages per hour</h3>
      <canvas id="hourChart"></canvas>
    </section>
    </div>

    <div class="grid2">
    <section class="card" id="messagesPerPersonSection">
      <h3>Messages per person</h3>
      <canvas id="personCountChart"></canvas>
      <div id="longestAvg"></div>
    </section>

    <section class="card" id="emojisPerPersonSection">
      <h3>Emojis per person</h3>
      <canvas id="emojiPerPersonChart"></canvas>
      <div class="controls">
        <button id="toggleTopEmojiListBtn" class="chip" type="button">Show per-person top emoji</button>
      </div>
      <div id="topEmojiPerPersonPanel" class="collapsible"><div id="topEmojiPerPerson" class="topEmojiGrid"></div></div>
    </section>
    </div>

    <div class="grid3">
    <section class="card">
      <h3>Messages by weekday</h3>
      <canvas id="weekdayChart"></canvas>
    </section>

    <section class="card">
      <h3>Messages by month</h3>
      <canvas id="monthChart"></canvas>
    </section>

    <section class="card">
      <h3>Message length distribution</h3>
      <canvas id="lengthHistChart"></canvas>
    </section>
    </div>

    <div class="grid3">
    <section class="card card-flex">
      <h3>Top 100 words (global)</h3>
      <div class="controls">
        <div class="muted">Click × to exclude a word.</div>
        <button id="toggleExcludedBtn" class="chip" type="button">Show excluded (0)</button>
      </div>
      <div id="excludedPanel" class="collapsible"><div id="excludedChips"></div></div>
      <div class="wordsScroll">
        <table id="topWordsTable">
          <thead><tr><th style="width:28px"> </th><th>Word</th><th>Count</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <!-- Group-only: participant share donut -->
    <section class="card" id="participantShareSection">
      <h3>Participants share</h3>
      <canvas id="participantShareChart" class="pieCanvas"></canvas>
      <div class="small muted">Top 10 participants by messages; others combined.</div>
    </section>

    <section class="card span2" id="twoPersonEmojisSection">
      <h3>Top emojis</h3>
      <div class="chartRow">
        <div style="flex:1; min-width:220px;">
          <div class="small"><strong id="mePieTitle">You</strong></div>
          <canvas class="pieCanvas" id="meEmojisPie"></canvas>
        </div>
        <div id="meEmojisLegend" class="legendList"></div>
      </div>
      <div class="chartRow" style="margin-top:12px;">
        <div style="flex:1; min-width:220px;">
          <div class="small"><strong id="partnerPieTitle">Partner</strong></div>
          <canvas class="pieCanvas" id="partnerEmojisPie"></canvas>
        </div>
        <div id="partnerEmojisLegend" class="legendList"></div>
      </div>
      <div class="small muted" style="margin-top:6px;">Each pie shows that person's top 10 emojis.</div>
    </section>

    </div>

    <div class="grid2">
    <section class="card" id="replySpeedSection">
      <h3>Reply speed (minutes)</h3>
      <div id="replyStats" class="small"></div>
    </section>

    <section class="card" id="specialMessagesSection">
      <h3>Special messages</h3>
      <div id="specialStats" class="small"></div>
    </section>
    </div>

    <div class="grid3">
    <section class="card" id="streaksSection">
      <h3>Streaks & gaps</h3>
      <div class="small muted"></div>
      <div id="streaksContent" class="small" style="margin-top:6px;"></div>
    </section>

    <section class="card" id="tfidfSection">
      <h3>Characteristic words (TF-IDF)</h3>
      <div class="small muted">Words that are relatively frequent for a person but rarer for others, computed via TF-IDF on per-person word frequencies.</div>
      <div id="tfidfLists" class="small" style="margin-top:6px;"></div>
    </section>

    <section class="card" id="firstLastSection">
      <h3>First/Last of the day</h3>
      <div class="small">Day cutoff: <span id="dayCutoffHour"></span>:00</div>
      <div id="firstLastContent" class="small"></div>
    </section>
    </div>
  </main>

  <footer style="margin-top:18px;" class="small muted">
    This report was generated by a local Node.js script. You can edit the stopwords in the script (or the HTML inlined consts) and re-run to regenerate.
  </footer>

  <script>${chartJsBundle || ''}</script>
  <script>
    const DATA = ${dataJson};
    const PERSON_WORD_MAPS = {};
    const EXCLUDED = new Set(Array.isArray(DATA.defaultFilterWords) ? DATA.defaultFilterWords.map(x=>String(x).toLowerCase()) : []);
    const USER_EXCLUDED = new Set();

    function escapeHtml(s) {
      return s.replace(/[&<>\"']/g, function(ch){
        return ch==='&'?'&amp;': ch==='<'?'&lt;': ch==='>'?'&gt;': ch==='"'?'&quot;':'&#39;';
      });
    }

    function downloadJSON(obj, filename) {
      const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function renderReport() {
      document.getElementById('totalMessages').textContent = DATA.meta.totalMessages;
      document.getElementById('distinctDays').textContent = DATA.meta.distinctDays;
      document.getElementById('avgPerDay').textContent = DATA.meta.avgMessagesPerDay.toFixed(2);
      document.getElementById('maxDay').textContent = DATA.meta.maxDay ? (DATA.meta.maxDay.date + ' (' + DATA.meta.maxDay.count + ')') : 'n/a';
      document.getElementById('distinctEmojiCount').textContent = DATA.meta.distinctEmojiCount;
      document.getElementById('mostCommonEmoji').textContent = DATA.meta.mostCommonEmoji && DATA.meta.mostCommonEmoji[0] ? (DATA.meta.mostCommonEmoji[0] + ' × ' + DATA.meta.mostCommonEmoji[1]) : 'n/a';

      const hourCtx = document.getElementById('hourChart').getContext('2d');
      new Chart(hourCtx, { type: 'bar', data: { labels: Array.from({length:24}, (_,i) => i + ':00'), datasets: [{ label: 'Messages by hour', data: DATA.messagesPerHour, backgroundColor: 'rgba(255, 223, 186, 0.8)' }] }, options: { responsive: true, maintainAspectRatio:false, plugins: {legend: {display:false}}, scales:{ x:{ ticks:{ autoSkip:true, maxRotation:0, minRotation:0 }}, y:{ beginAtZero:true } } } });

      // Participants (excluding system)
      const pNames = Object.keys(DATA.perPersonSummary).filter(n=>n!=='system');
      // If more than 2 participants, hide the 2-person-specific sections
      const twoPersonOnly = pNames.length <= 2;
      // Apply visual theme based on chat type
      try {
        document.body.classList.remove('theme-couple','theme-group');
        document.body.classList.add(twoPersonOnly ? 'theme-couple' : 'theme-group');
      } catch (e) {}
      const twoPersonEmojisSection = document.getElementById('twoPersonEmojisSection');
      const replySpeedSection = document.getElementById('replySpeedSection');
      const specialMessagesSection = document.getElementById('specialMessagesSection');
      const messagesPerPersonSection = document.getElementById('messagesPerPersonSection');
      const emojisPerPersonSection = document.getElementById('emojisPerPersonSection');
      if (!twoPersonOnly) {
        if (twoPersonEmojisSection) twoPersonEmojisSection.style.display = 'none';
        if (replySpeedSection) replySpeedSection.style.display = 'none';
        if (specialMessagesSection) specialMessagesSection.style.display = 'none';
        if (messagesPerPersonSection) messagesPerPersonSection.classList.add('span2');
        if (emojisPerPersonSection) emojisPerPersonSection.classList.add('span2');
      } else {
        if (messagesPerPersonSection) messagesPerPersonSection.classList.remove('span2');
        if (emojisPerPersonSection) emojisPerPersonSection.classList.remove('span2');
      }
      // Show all for groups, cap for 1:1
      const displayCount = twoPersonOnly ? Math.min(pNames.length, 20) : pNames.length;
      // Sort participants by message count (descending) for both per-person charts
      const sortedByMsgs = pNames
        .map(n => ({ name: n, count: DATA.perPersonSummary[n].count || 0 }))
        .sort((a,b) => b.count - a.count);
      const sortedNames = sortedByMsgs.map(x => x.name);
      const pCounts = sortedByMsgs.map(x => x.count);
      const topMsgNames = sortedNames.slice(0, displayCount);
      const topMsgCounts = pCounts.slice(0, displayCount);
      const personCanvas = document.getElementById('personCountChart');
      const personCtx = personCanvas.getContext('2d');
      new Chart(personCtx, { type: 'bar', data: { labels: topMsgNames, datasets: [{ label:'Messages', data: topMsgCounts, backgroundColor: 'rgba(186, 225, 255, 0.7)' }]}, options: { responsive:true, maintainAspectRatio:false, plugins: {legend:{display:false}}, scales:{ x:{ ticks:{ autoSkip:true, maxRotation:45, minRotation:0 }}, y:{ beginAtZero:true } } } });

      document.getElementById('longestAvg').textContent = DATA.longestAvgPerson ? ('Longest avg message (chars): ' + DATA.longestAvgPerson) : '';

      const emojiCountsMap = pNames.reduce((acc, n) => { acc[n] = DATA.perPersonSummary[n].totalEmojis || 0; return acc; }, {});
      const sortedByEmoji = pNames
        .map(n => ({ name: n, count: emojiCountsMap[n] || 0 }))
        .sort((a,b) => b.count - a.count);
      const emojiSortedNames = sortedByEmoji.map(x => x.name);
      const emojiCounts = sortedByEmoji.map(x => x.count);
      const topEmojiNames = emojiSortedNames.slice(0, displayCount);
      const topEmojiCounts = emojiCounts.slice(0, displayCount);
      const emojiCanvas = document.getElementById('emojiPerPersonChart');
      const emojiCtx = emojiCanvas.getContext('2d');
      new Chart(emojiCtx, { type: 'bar', data: { labels: topEmojiNames, datasets: [{ label:'Emoji count', data: topEmojiCounts, backgroundColor: 'rgba(255, 179, 186, 0.6)' }]}, options: { responsive:true, maintainAspectRatio:false, plugins: {legend:{display:false}}, scales:{ x:{ ticks:{ autoSkip:true, maxRotation:45, minRotation:0 }}, y:{ beginAtZero:true }} } });

      // Group-only: participant share donut
      const shareSection = document.getElementById('participantShareSection');
      if (!twoPersonOnly) {
        if (shareSection) shareSection.style.display = '';
        const top10 = sortedByMsgs.slice(0, 20);
        const others = sortedByMsgs.slice(20).reduce((s, x) => s + (x.count || 0), 0);
        const shareLabels = top10.map(x => x.name).concat(others ? ['Others'] : []);
        const shareData = top10.map(x => x.count).concat(others ? [others] : []);
        const pieColors = ['#bae1ff','#ffd1dc','#c1e1c1','#fce1a8','#e6c2ff','#ffdfba','#f1c0e8','#caffbf','#bde0fe','#ffc6ff','#a0e7e5'];
        const shareCtx = document.getElementById('participantShareChart').getContext('2d');
        new Chart(shareCtx, { type: 'doughnut', data: { labels: shareLabels, datasets: [{ data: shareData, backgroundColor: shareLabels.map((_,i)=> pieColors[i % pieColors.length]) }] }, options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ display:true, position:'bottom' } } } });
      } else {
        if (shareSection) shareSection.style.display = 'none';
      }

      // Collapsible per-person top emoji list (top 20 by emoji count)
      const topEmojiDiv = document.getElementById('topEmojiPerPerson');
      const topEmojiPanel = document.getElementById('topEmojiPerPersonPanel');
      const topEmojiBtn = document.getElementById('toggleTopEmojiListBtn');
      const listNames = topEmojiNames;
      if (topEmojiDiv) {
        topEmojiDiv.innerHTML = listNames.map(n => {
          const top = DATA.perPersonSummary[n].topEmojis && DATA.perPersonSummary[n].topEmojis.length ? DATA.perPersonSummary[n].topEmojis[0] : null;
          return '<div><strong>' + n + ':</strong> ' + (top ? (top[0] + ' × ' + top[1]) : '—') + '</div>';
        }).join('');
      }
      let emojiListOpen = false;
      function setEmojiListOpen(open){
        emojiListOpen = !!open;
        if (topEmojiPanel) topEmojiPanel.classList.toggle('open', emojiListOpen);
        updateEmojiListToggleLabel();
      }
      function updateEmojiListToggleLabel(){
        if (!topEmojiBtn) return;
        const count = listNames.length;
        topEmojiBtn.textContent = (emojiListOpen ? 'Hide per-person top emoji ('+count+')' : 'Show per-person top emoji ('+count+')');
      }
      if (topEmojiBtn){
        topEmojiBtn.addEventListener('click', ()=> setEmojiListOpen(!emojiListOpen));
        updateEmojiListToggleLabel();
        setEmojiListOpen(false);
      }

      // Excluded words UI and logic
      const chipsDiv = document.getElementById('excludedChips');
      const excludedPanel = document.getElementById('excludedPanel');
      const toggleExcludedBtn = document.getElementById('toggleExcludedBtn');
      let excludedOpen = false;
      function setExcludedOpen(open){
        excludedOpen = !!open;
        if (excludedPanel) excludedPanel.classList.toggle('open', excludedOpen);
        updateExcludedToggleLabel();
      }
      function getAllExcluded(){
        return Array.from(new Set([...EXCLUDED, ...USER_EXCLUDED]));
      }
      function updateExcludedToggleLabel(){
        if (!toggleExcludedBtn) return;
        const count = getAllExcluded().length;
        toggleExcludedBtn.textContent = (excludedOpen ? 'Hide excluded ('+count+')' : 'Show excluded ('+count+')');
      }
      if (toggleExcludedBtn){
        toggleExcludedBtn.addEventListener('click', ()=> setExcludedOpen(!excludedOpen));
      }
      function renderExcludedChips() {
        if (!chipsDiv) return;
        const all = getAllExcluded();
        chipsDiv.innerHTML = all.map(w => {
          const esc = escapeHtml(w);
          return '<span class="chip" data-word="'+esc+'"><span>'+esc+'</span><span class="x" title="Remove">×</span></span>';
        }).join('');
        chipsDiv.querySelectorAll('.chip .x').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const w = e.currentTarget.parentElement.getAttribute('data-word');
            // Only remove from user exclusions; built-in remain unless user re-adds via table
            USER_EXCLUDED.delete(w.toLowerCase());
            renderExcludedChips();
            renderTopWords();
          });
        });
        updateExcludedToggleLabel();
      }
      function isExcluded(word) {
        const lw = String(word).toLowerCase();
        return EXCLUDED.has(lw) || USER_EXCLUDED.has(lw);
      }
      function getPerPersonCountsForWord(word) {
        const res = {};
        const ppl = DATA.perPersonWordCounts || {};
        for (const name of Object.keys(ppl)) {
          const arr = ppl[name];
          if (!arr) continue;
          if (!PERSON_WORD_MAPS[name]) PERSON_WORD_MAPS[name] = new Map(arr);
          const v = PERSON_WORD_MAPS[name].get(word) || 0;
          if (v) res[name] = v;
        }
        return res;
      }
      function ensurePersonWordMaps() {
        const ppl = DATA.perPersonWordCounts || {};
        for (const name of Object.keys(ppl)) {
          if (!PERSON_WORD_MAPS[name]) PERSON_WORD_MAPS[name] = new Map(ppl[name] || []);
        }
      }
      const topWordsTbody = document.querySelector('#topWordsTable tbody');
      const tableWrapper = document.querySelector('#topWordsTable').parentElement;
      const breakdownDiv = document.createElement('div');
      breakdownDiv.id = 'wordBreakdown';
      breakdownDiv.className = 'small';
      tableWrapper.parentElement.insertBefore(breakdownDiv, tableWrapper);
      function renderTopWords() {
        if (!topWordsTbody) return;
        topWordsTbody.innerHTML = '';
        breakdownDiv.innerHTML = '';
        const filterSet = new Set([...EXCLUDED, ...USER_EXCLUDED]);
        const source = Array.isArray(DATA.globalWordCounts) ? DATA.globalWordCounts : (DATA.top100Words || []);
        const rows = source.filter(([w,_]) => !filterSet.has(String(w).toLowerCase())).slice(0,100);
        for (const [w,c] of rows) {
          const tr = document.createElement('tr');
          const esc = escapeHtml(w);
          tr.innerHTML = '<td title="Exclude \'+esc+'\" style="width:28px;">\
            <button aria-label="Exclude" class="chip" style="padding:2px 6px;" data-word="'+esc+'">×</button></td>\
            <td>' + esc + '</td><td>' + c + '</td>';
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => {
            const counts = getPerPersonCountsForWord(w);
            const entries = Object.entries(counts);
            const total = entries.reduce((s, [,v]) => s+v, 0) || 0;
            const lines = entries
              .sort((a,b)=>b[1]-a[1])
              .map(([name, v]) => escapeHtml(name) + ': ' + v + (total? (' ('+ (100*v/total).toFixed(1)+'%)') : ''));
            breakdownDiv.innerHTML = '<div><strong>"'+escapeHtml(w)+'" usage by person:</strong></div>' +
                                     (lines.length? lines.map(x=>'<div>'+x+'</div>').join('') : '<div>no usage data</div>');
          });
          tr.addEventListener('mouseenter', () => {
            const counts = getPerPersonCountsForWord(w);
            const entries = Object.entries(counts);
            const total = entries.reduce((s, [,v]) => s+v, 0) || 0;
            const tip = entries
              .sort((a,b)=>b[1]-a[1])
              .map(([name,v]) => name+': '+(total? (100*v/total).toFixed(0)+'%' : '0%'))
              .join('  •  ');
            tr.title = tip;
          });
          // Exclude button
          const btn = tr.querySelector('button[data-word]');
          if (btn) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const w = e.currentTarget.getAttribute('data-word');
              USER_EXCLUDED.add(String(w).toLowerCase());
              renderExcludedChips();
              renderTopWords();
            });
          }
          topWordsTbody.appendChild(tr);
        }
      }
      renderExcludedChips();
      setExcludedOpen(false);
      renderTopWords();

      // Emoji pies: show top emojis for "me" and for "partner" only for 1:1 or 2-person chats
      if (twoPersonOnly) {
        ensurePersonWordMaps();
        const meEmojisPieCtx = document.getElementById('meEmojisPie').getContext('2d');
        const partnerEmojisPieCtx = document.getElementById('partnerEmojisPie').getContext('2d');
        const pastel = ['#ffd1dc','#c1e1c1','#cde7f0','#fce1a8','#e6c2ff','#ffdfba','#bae1ff','#f1c0e8','#caffbf','#bde0fe','#ffc6ff','#a0e7e5'];
        const state = { mePie: null, partnerPie: null };

      function computeTopEmojisFor(personName) {
        const arr = (DATA.perPersonSummary[personName] && DATA.perPersonSummary[personName].topEmojis) || [];
        const top5 = arr.slice(0,10);
        const labels = top5.map(([e,_]) => e);
        const data = top5.map(([_,c]) => c);
        const colors = labels.map((_, i) => pastel[i % pastel.length]);
        return { labels, data, colors };
      }
      function buildLegend(containerId, labels, data, colors) {
        const el = document.getElementById(containerId);
        if (!el) return;
        let html = '';
        for (let i=0;i<labels.length;i++) {
          html += '<div class="legendItem"><span class="swatch" style="background:'+colors[i]+'"></span>'
               + '<span>'+escapeHtml(labels[i])+'</span>'
               + '<span style="margin-left:auto;">'+(data[i]||0)+'</span></div>';
        }
        el.innerHTML = html || '<div class="muted">No data</div>';
      }
      // Determine "me" and "partner"
      const sortedByCount = pNames.slice().sort((x,y)=>DATA.perPersonSummary[y].count - DATA.perPersonSummary[x].count);
      let me = DATA.meta.meName && pNames.includes(DATA.meta.meName) ? DATA.meta.meName : (sortedByCount[0] || pNames[0] || null);
      let partner = (sortedByCount.find(n => n !== me)) || null;
      const meTitleEl = document.getElementById('mePieTitle');
      const partnerTitleEl = document.getElementById('partnerPieTitle');
      if (meTitleEl) meTitleEl.textContent = me ? me : 'You';
      if (partnerTitleEl) partnerTitleEl.textContent = partner ? partner : 'Partner';

      function renderMePie() {
        const { labels, data, colors } = me ? computeTopEmojisFor(me) : { labels:[], data:[], colors:[] };
        if (!state.mePie) {
          state.mePie = new Chart(meEmojisPieCtx, { type: 'pie', data: { labels, datasets: [{ data, backgroundColor: colors }] }, options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ display:false } } } });
        } else {
          state.mePie.data.labels = labels;
          state.mePie.data.datasets[0].data = data;
          state.mePie.data.datasets[0].backgroundColor = colors;
          state.mePie.update();
        }
        buildLegend('meEmojisLegend', labels, data, colors);
      }
      function renderPartnerPie() {
        const { labels, data, colors } = partner ? computeTopEmojisFor(partner) : { labels:[], data:[], colors:[] };
        if (!state.partnerPie) {
          state.partnerPie = new Chart(partnerEmojisPieCtx, { type: 'pie', data: { labels, datasets: [{ data, backgroundColor: colors }] }, options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ display:false } } } });
        } else {
          state.partnerPie.data.labels = labels;
          state.partnerPie.data.datasets[0].data = data;
          state.partnerPie.data.datasets[0].backgroundColor = colors;
          state.partnerPie.update();
        }
        buildLegend('partnerEmojisLegend', labels, data, colors);
      }
        renderMePie();
        renderPartnerPie();
      }

      // (Removed global top 5 pies; now showing per-person top emojis for you and partner.)

      // Weekday chart
      const weekdayCtx = document.getElementById('weekdayChart').getContext('2d');
      const weekdayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      new Chart(weekdayCtx, { type: 'bar', data: { labels: weekdayLabels, datasets: [{ label:'Messages by weekday', data: DATA.messagesPerWeekday, backgroundColor: 'rgba(196, 255, 214, 0.8)' }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } } } });

      // Monthly trend chart
      const monthCtx = document.getElementById('monthChart').getContext('2d');
      const monthLabels = DATA.messagesPerMonth.map(([k,_]) => k);
      const monthCounts = DATA.messagesPerMonth.map(([_,v]) => v);
      new Chart(monthCtx, { type: 'line', data: { labels: monthLabels, datasets: [{ label:'Messages by month', data: monthCounts, borderColor:'#a0e7e5', backgroundColor:'rgba(160,231,229,0.3)', fill:true, tension: 0.25 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ ticks:{ autoSkip:true, maxRotation:0, minRotation:0 }}, y:{ beginAtZero:true } } } });

      // Message length histogram
      const lengthCtx = document.getElementById('lengthHistChart').getContext('2d');
      const bins = DATA.lengthHistogram.bins;
      const counts = DATA.lengthHistogram.counts;
      const labels = bins.map((b, i) => i === 0 ? ('0–' + b) : (bins[i-1]+1 + '–' + b)).concat((bins[bins.length-1]+1) + '+');
      new Chart(lengthCtx, { type: 'bar', data: { labels, datasets: [{ label:'Messages by length (chars)', data: counts, backgroundColor:'rgba(204, 204, 255, 0.8)' }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } } } });

      // Sentiment (two-person only)
      const streaksSection = document.getElementById('streaksSection');
      const tfidfSection = document.getElementById('tfidfSection');
      const firstLastSection = document.getElementById('firstLastSection');
      if (!twoPersonOnly) {
        if (streaksSection) streaksSection.style.display = 'none';
        if (tfidfSection) tfidfSection.style.display = 'none';
        if (firstLastSection) firstLastSection.style.display = 'none';
      } else {
        if (streaksSection) streaksSection.style.display = '';
        if (tfidfSection) tfidfSection.style.display = '';
        if (firstLastSection) firstLastSection.style.display = '';
        

        // Streaks & gaps
        const stDiv = document.getElementById('streaksContent');
        if (stDiv) {
          function fmtGap(min){ if (!isFinite(min)) return 'n/a'; const d=Math.floor(min/1440); const h=Math.floor((min%1440)/60); const m=Math.floor(min%60); const parts=[]; if(d) parts.push(d+'d'); if(h) parts.push(h+'h'); if(m||!parts.length) parts.push(m+'m'); return parts.join(' '); }
          function fmtDate(ts){ if(!ts) return 'n/a'; try { return new Date(ts).toISOString().slice(0,10); } catch(e){ return 'n/a'; } }
          const ls = DATA.longestStreak || { start:null, end:null, lengthDays:0 };
          const lg = DATA.longestGap || { minutes:0, breaker:null, startTs:null, endTs:null };
          const lguw = DATA.longestGapUnderWeek || { minutes:0, breaker:null, startTs:null, endTs:null };
          const sb = DATA.silenceBreakers || {};
          const sbEntries = Object.entries(sb).sort((a,b)=>b[1]-a[1]).map(([n,c]) => n+': '+c);
          stDiv.innerHTML = [
            '<div><strong>Longest daily streak</strong>: '+(ls.lengthDays||0)+' days'+(ls.start? (' ('+ls.start+' → '+(ls.end||ls.start)+')'):'')+'</div>',
            '<div><strong>Who breaks silence (≥24h)</strong>: '+(sbEntries.join(', ')||'—')+'</div>'
          ].join('');
        }

        // TF-IDF lists
        const tfDiv = document.getElementById('tfidfLists');
        if (tfDiv) {
          const names = pNames.slice(0, 2);
          const blocks = names.map(n => {
            const arr = (DATA.tfidfTopWords && DATA.tfidfTopWords[n]) ? DATA.tfidfTopWords[n].slice(0,30) : [];
            const items = arr.map(([w,_]) => '<span class="chip" style="margin:2px;">'+escapeHtml(w)+'</span>').join('');
            return '<div style="margin-bottom:6px;"><div><strong>'+escapeHtml(n)+'</strong></div><div>'+ (items || '<span class="muted">—</span>') +'</div></div>';
          }).join('');
          tfDiv.innerHTML = blocks;
        }

        // First/Last of shifted day
        const flDiv = document.getElementById('firstLastContent');
        const cutoffEl = document.getElementById('dayCutoffHour');
        if (cutoffEl) cutoffEl.textContent = String(DATA.dayCutoffHour || 4);
        if (flDiv) {
          const first = DATA.firstOfDayCounts || {};
          const last = DATA.lastOfDayCounts || {};
          const order = pNames;
          const firstLine = order.map(n => n+': '+(first[n]||0)).join(', ');
          const lastLine = order.map(n => n+': '+(last[n]||0)).join(', ');
          flDiv.innerHTML = '<div><strong>First message</strong>: '+firstLine+'</div>' +
                            '<div><strong>Last message</strong>: '+lastLine+'</div>';
        }
      }

      if (twoPersonOnly) {
        const replyElem = document.getElementById('replyStats');
        // Comparative reply metrics for top two participants
        let a = pNames[0] || null, b = pNames[1] || null;
        // pick by counts if possible
        if (pNames.length > 2) {
          const sortedByCount = pNames.slice().sort((x,y)=>DATA.perPersonSummary[y].count - DATA.perPersonSummary[x].count);
          a = sortedByCount[0]; b = sortedByCount[1];
        }
        if (a && b) {
          const sa = DATA.perPersonSummary[a];
          const sb = DATA.perPersonSummary[b];
          const fmt = v => (v!=null && isFinite(v)) ? v.toFixed(1)+'m' : 'n/a';
          replyElem.innerHTML = [
            '<div><strong>Mean</strong>: '+a+' '+fmt(sa.meanReplyMinutes)+' vs '+b+' '+fmt(sb.meanReplyMinutes)+'</div>',
            '<div><strong>Median</strong>: '+a+' '+fmt(sa.medianReplyMinutes)+' vs '+b+' '+fmt(sb.medianReplyMinutes)+'</div>',
            '<div><strong>Mean (excl >6h)</strong>: '+a+' '+fmt(sa.meanExclOvernightMinutes)+' vs '+b+' '+fmt(sb.meanExclOvernightMinutes)+'</div>',
          ].join('');
        } else {
          replyElem.textContent = 'Not enough participants to compare reply times.';
        }
        // Explanation of reply metrics (visible bullets)
        if (replyElem && replyElem.parentElement) {
          const explain = document.createElement('div');
          explain.className = 'small';
          explain.innerHTML = '<ul style="margin-top:6px;">'
            + '<li><strong>Mean</strong>: average minutes between a message and the previous other-person message.</li>'
            + '<li><strong>Median</strong>: the middle value; less sensitive to outliers.</li>'
            + '<li><strong>Mean (excl >6h)</strong>: mean ignoring long gaps (overnight/inactive periods) above 6 hours.</li>'
            + '</ul>';
          replyElem.parentElement.appendChild(explain);
        }
      }

      // Legends now render next to charts via buildLegend()

      // Special message stats
      const sDiv = document.getElementById('specialStats');
      if (sDiv) {
        const s = DATA.specialMessageStats || { mediaOmitted:0, deleted:0, linkOnly:0, perPerson:{} };
        const rows = [];
        rows.push('Media omitted: ' + s.mediaOmitted);
        rows.push('Deleted: ' + s.deleted);
        rows.push('Link-only: ' + s.linkOnly);
        const per = Object.keys(s.perPerson).map(name => {
          const p = s.perPerson[name];
          return '<div><strong>'+escapeHtml(name)+':</strong> media '+(p.mediaOmitted||0)+', deleted '+(p.deleted||0)+', links '+(p.linkOnly||0)+'</div>';
        }).join('');
        sDiv.innerHTML = rows.map(r => '<div>'+escapeHtml(r)+'</div>').join('') + per;
      }

      // Clickable top words: show per-person breakdown
      // Note: Top words row listeners are bound in renderTopWords() to support live filtering
    }

    (function ensureChartAndRender(){
      if (typeof Chart !== 'undefined') { renderReport(); return; }
      var cdn = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      var script = document.createElement('script');
      script.src = cdn;
      script.onload = function(){ if (typeof Chart !== 'undefined') { renderReport(); } };
      script.onerror = function(){
        var warn = document.createElement('div');
        warn.style.cssText = 'background:#fff3cd;color:#664d03;padding:8px 12px;border:1px solid #ffecb5;border-radius:8px;margin-bottom:12px;';
        warn.textContent = 'Chart.js failed to load. Install it locally (npm i chart.js) and re-run the script to embed it, or connect to the internet to allow CDN fallback.';
        document.body.insertBefore(warn, document.body.firstChild);
      };
      document.head.appendChild(script);
    })();
  </script>
</body>
</html>`;
}

// Run main
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
