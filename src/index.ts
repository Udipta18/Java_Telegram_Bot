import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { saveQuestion, getQuestions, searchQuestions } from './db.js';
import { classifyQuestion, extractQuestionsFromImage } from './openai.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Parse JSON request bodies
app.use(express.json());

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Telegram Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { message, callback_query } = req.body;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // Handle button clicks (callback queries)
    if (callback_query && callback_query.message && callback_query.message.chat) {
      const chatId = callback_query.message.chat.id;
      const data = callback_query.data;

      // Answer callback query immediately to clear the loading spinner
      if (botToken && botToken !== 'your_telegram_bot_token_here') {
        try {
          await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            callback_query_id: callback_query.id
          });
        } catch (err: any) {
          console.error('Error answering callback query:', err?.message || err);
        }
      }

      if (data && data.startsWith('select_topic:')) {
        const topic = data.substring(13); // Extract topic name
        try {
          const questions = await getQuestions(topic);
          const questionsList = questions
            .map((q, idx) => `<b>${idx + 1}. [${q.sub_topic || 'General'}]</b>\n${q.question}`)
            .join('\n\n');

          const replyText = questionsList.length > 0
            ? `<b>Questions in ${topic}:</b>\n\n${questionsList}`
            : `No questions found in topic "${topic}".`;

          if (botToken && botToken !== 'your_telegram_bot_token_here') {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText,
              parse_mode: 'HTML'
            });
          } else {
            console.log(`Questions in topic ${topic}:\n`, replyText);
          }
        } catch (err: any) {
          console.error('Error fetching questions for topic:', err?.message || err);
        }
      }
    }
    // Handle standard messages
    else if (message && message.chat && message.chat.id) {
      const chatId = message.chat.id;
      const text = message.text as string | undefined;
      const photo = message.photo;

      // Handle screenshots / photos
      if (photo && photo.length > 0) {
        if (!botToken || botToken === 'your_telegram_bot_token_here') {
          console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured. Cannot process photo webhook.');
        } else {
          // Get the largest photo size
          const largestPhoto = photo[photo.length - 1];
          const fileId = largestPhoto.file_id;

          // Retrieve file path
          const fileResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
          if (fileResponse.data && fileResponse.data.ok) {
            const filePath = fileResponse.data.result.file_path;

            // Download file as arraybuffer
            const downloadResponse = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
              responseType: 'arraybuffer'
            });
            const base64Image = Buffer.from(downloadResponse.data, 'binary').toString('base64');

            // Extract questions using OpenAI Vision
            const questions = await extractQuestionsFromImage(base64Image);

            if (questions.length > 0) {
              // Classify and save each question
              await Promise.all(
                questions.map(async (q) => {
                  const { topic, subTopic } = await classifyQuestion(q);
                  await saveQuestion(q, topic, subTopic);
                })
              );
            }

            // Reply back to Telegram
            const replyText = `Found ${questions.length} questions.`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        }
      }
      // Handle normal text message (not starting with /)
      else if (text && !text.startsWith('/')) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length === 1) {
          const question = lines[0];
          // Classify the question using OpenAI
          const { topic, subTopic } = await classifyQuestion(question);

          // Save the question to the database
          await saveQuestion(question, topic, subTopic);

          if (!botToken || botToken === 'your_telegram_bot_token_here') {
            console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured.');
          } else {
            // Send response back to Telegram
            const replyText = `✅ Saved\nTopic: ${topic}\nSub Topic: ${subTopic}`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        } else if (lines.length > 1) {
          // Save and classify each question
          await Promise.all(
            lines.map(async (line) => {
              const { topic, subTopic } = await classifyQuestion(line);
              await saveQuestion(line, topic, subTopic);
            })
          );

          if (!botToken || botToken === 'your_telegram_bot_token_here') {
            console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured.');
          } else {
            const replyText = `Saved ${lines.length} questions.`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        }
      }
      // Handle commands (starting with /)
      else if (text && text.startsWith('/')) {
        const parts = text.split(' ');
        const command = parts[0].toLowerCase();

        if (command === '/help') {
          const helpText = `<b>📖 AI Interview Question Vault Bot</b>

Send any text message to save it as an interview question.
Send a photo/screenshot to extract questions using AI.

<b>Available Commands:</b>
/help - Show this help message
/topics - List all saved topics
/search &lt;keyword&gt; - Search questions by keyword
/random - Show a random interview question`;

          if (botToken && botToken !== 'your_telegram_bot_token_here') {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: helpText,
              parse_mode: 'HTML'
            });
          } else {
            console.log('Help command received, but token not configured.');
          }
        } else if (command === '/topics') {
          try {
            const questions = await getQuestions();
            const topicCounts: { [key: string]: number } = {};
            questions.forEach((q) => {
              const t = q.topic || 'General';
              topicCounts[t] = (topicCounts[t] || 0) + 1;
            });

            if (Object.keys(topicCounts).length === 0) {
              const replyText = 'No questions or topics saved yet.';
              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText
                });
              } else {
                console.log(replyText);
              }
            } else {
              const inlineKeyboard = Object.entries(topicCounts).map(([topic, count]) => {
                return [
                  {
                    text: `${topic} (${count})`,
                    callback_data: `select_topic:${topic}`
                  }
                ];
              });

              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: 'Select a topic to view its questions:',
                  reply_markup: {
                    inline_keyboard: inlineKeyboard
                  }
                });
              } else {
                console.log('Topics command processed with inline keyboard simulation:');
                console.log(JSON.stringify(inlineKeyboard, null, 2));
              }
            }
          } catch (err: any) {
            console.error('Error in /topics:', err?.message || err);
          }
        } else if (command === '/search') {
          const keyword = parts.slice(1).join(' ').trim();
          if (!keyword) {
            if (botToken && botToken !== 'your_telegram_bot_token_here') {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: 'Please specify a keyword to search. Example: /search Java'
              });
            } else {
              console.log('Search command received without keyword.');
            }
          } else {
            try {
              const results = await searchQuestions(keyword);
              if (results.length === 0) {
                const replyText = `No questions found matching "${keyword}".`;
                if (botToken && botToken !== 'your_telegram_bot_token_here') {
                  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    chat_id: chatId,
                    text: replyText
                  });
                } else {
                  console.log(replyText);
                }
              } else {
                const resultsList = results
                  .map((q, idx) => `<b>${idx + 1}. [${q.topic || 'General'}]</b>\n${q.question}`)
                  .join('\n\n');
                const replyText = `<b>Matching questions for "${keyword}":</b>\n\n${resultsList}`;

                if (botToken && botToken !== 'your_telegram_bot_token_here') {
                  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    chat_id: chatId,
                    text: replyText,
                    parse_mode: 'HTML'
                  });
                } else {
                  console.log(replyText);
                }
              }
            } catch (err: any) {
              console.error('Error in /search:', err?.message || err);
            }
          }
        } else if (command === '/random') {
          try {
            const questions = await getQuestions();
            if (questions.length === 0) {
              const replyText = 'No questions saved yet.';
              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText
                });
              } else {
                console.log(replyText);
              }
            } else {
              const randomIndex = Math.floor(Math.random() * questions.length);
              const randomQ = questions[randomIndex];
              const replyText = `🎲 <b>Random Question</b> [ID: ${randomQ.id}]\n\n<b>Topic:</b> ${randomQ.topic || 'General'} / ${randomQ.sub_topic || 'General'}\n\n<b>Question:</b>\n${randomQ.question}`;

              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText,
                  parse_mode: 'HTML'
                });
              } else {
                console.log('Random question selected:\n', replyText);
              }
            }
          } catch (err: any) {
            console.error('Error in /random:', err?.message || err);
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error handling webhook update:', error?.message || error);
  }

  // Always respond with 200 OK to Telegram to acknowledge receipt
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


