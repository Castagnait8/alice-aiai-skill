const fetch = require('node-fetch');

// API-ключ AIAI.BY и адрес эндпоинта, настроенные через переменные окружения Vercel
const AIAI_API_KEY = process.env.AIAI_API_KEY;
const AIAI_BASE_URL = 'https://api.aiai.by/v1/chat/completions';

// Состояние сессии: сохраняем только в памяти (в производственной среде рекомендуется Redis/KV)
// Здесь для демонстрации используется простой объект, в реальных условиях нужно самостоятельно обрабатывать session_state
const sessions = {};

module.exports = async (req, res) => {
  // Обработка CORS-предзапроса (Vercel обычно не требуется, но оставлено для отладки)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Проверка: Яндекс Диалоги отправляют POST-запросы
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;
    const sessionId = body.session?.session_id || 'default';
    const userText = body.request?.original_utterance || '';

    // Обработка пустого ввода (обычно при первом запуске навыка)
    if (!userText.trim()) {
      return res.json({
        response: {
          text: 'Привет! Я умный помощник на базе AIAI. Спросите меня о чём-нибудь.',
          end_session: false,
        },
        version: '1.0',
      });
    }

    // Получаем или инициализируем историю диалога
    if (!sessions[sessionId]) {
      sessions[sessionId] = [
        { role: 'system', content: 'Ты полезный, краткий и дружелюбный ассистент. Отвечай по-русски, не более 2-3 предложений, чтобы подходить для голосового вывода.' }
      ];
    }
    const messages = sessions[sessionId];

    // Добавляем текущий вопрос пользователя
    messages.push({ role: 'user', content: userText });

    // Вызов AIAI.BY
    const aiResponse = await fetch(AIAI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AIAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'qwen3.7-flash', // Можно заменить на нужную модель, например claude-sonnet-4-20250514
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AIAI error:', errText);
      throw new Error('AIAI request failed');
    }

    const aiData = await aiResponse.json();
    const replyText = aiData.choices?.[0]?.message?.content || 'Извините, я не смог получить ответ.';

    // Сохраняем ответ ассистента в историю
    messages.push({ role: 'assistant', content: replyText });

    // Ограничиваем историю последними 10 сообщениями для экономии токенов
    if (messages.length > 12) {
      sessions[sessionId] = messages.slice(-10);
    }

    // Возвращаем ответ в формате, требуемом Яндекс Диалогами
    res.json({
      response: {
        text: replyText,
        end_session: false,
      },
      session_state: {
        // Можно сохранять пользовательские данные, если необходимо
      },
      version: '1.0',
    });

  } catch (error) {
    console.error('Skill error:', error);
    // При любой ошибке возвращаем запасной ответ, чтобы навык не выглядел неработающим
    res.json({
      response: {
        text: 'Извините, произошла временная ошибка. Попробуйте позже.',
        end_session: false,
      },
      version: '1.0',
    });
  }
};
