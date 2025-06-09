// Shared username generation logic (no Firebase dependencies)

const usernameComponents = {
  place: [
    'street',
    'city',
    'avenue',
    'plaza',
    'urban',
    'calle',
    'ciudad',
    'barrio'
  ],
  role: [
    'creator',
    'builder',
    'designer',
    'architect',
    'maker',
    'creador',
    'constructor'
  ]
};

const generateRandomSuffix = (length = 4) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const generateUsername = () => {
  const place =
    usernameComponents.place[
      Math.floor(Math.random() * usernameComponents.place.length)
    ];
  const role =
    usernameComponents.role[
      Math.floor(Math.random() * usernameComponents.role.length)
    ];
  const suffix = generateRandomSuffix();
  return `${place}_${role}_${suffix}`;
};

module.exports = {
  usernameComponents,
  generateRandomSuffix,
  generateUsername
};
