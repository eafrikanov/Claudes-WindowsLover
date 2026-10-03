// Ретранслятор для сетей, где прямое соединение запрещено (школьный и офисный Wi‑Fi).
// Бесплатный TURN Metered Open Relay (20 ГБ в месяц): https://dashboard.metered.ca → TURN Server → Credentials.
// iceServers — постоянные логин и пароль из раздела Credentials; если их сменить там, поменять и здесь.
// Вместо них можно указать API-ключ: meteredApp — поддомен приложения (для myapp.metered.live это "myapp").
const METERED_USER = '4b0cb30cac41bb3b7b6898c6';
const METERED_PASS = 'P0/2JXiyYla6yPcu';

export const TURN = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp',
      ],
      username: METERED_USER,
      credential: METERED_PASS,
    },
  ],
  meteredApp: '',
  meteredApiKey: '',
};
