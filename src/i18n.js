// Multi-language dictionary (English, French, Arabic with RTL support)

export const SUPPORTED_LANGUAGES = ['en', 'fr', 'ar'];

export const MESSAGES = {
  en: {
    welcome_select_language:
      '👋 Welcome to the Student Verification Bot!\n\nPlease select your preferred language:\nVeuillez choisir votre langue :\nيرجى اختيار لغتك المفضلة:',
    language_saved:
      '🇬🇧 Language set to English.\n\nType /verify to verify your student ID (matricule), or /language to change your language at any time.',
    choose_language: '🌐 Please select your preferred language:',
    private_only:
      '🔒 For your privacy, please send /verify to me in a private message (click my name and press Start).',
    already_verified:
      '✅ You are already verified! If you believe this is a mistake, please contact a group administrator.',
    prompt_matricule:
      '🎓 Please enter your student ID / matricule (letters or numbers, e.g., 232331001001):',
    invalid_matricule_format:
      '⚠️ Invalid format. Please enter a valid student ID containing only digits/letters (4 to 20 characters).',
    unknown_matricule:
      '❌ Student ID not found in the official student list. Please check your number and try /verify again.',
    matricule_already_claimed:
      '❌ This student ID has already been claimed by another Telegram account.',
    confirm_identity: ({ fullName, matricule, section }) =>
      `🔎 Student record found:\n\n👤 Name: ${fullName}\n🆔 Student ID: ${matricule}\n🏫 Group/Section: ${section || 'General'}\n\nIs this you?`,
    btn_confirm: '✅ Confirm, this is me',
    btn_cancel: '❌ Cancel',
    verification_success: ({ fullName, matricule }) =>
      `🎉 Verification complete!\n\nYour Telegram account is now permanently linked to:\n👤 ${fullName} (${matricule})\n\nWelcome to the community!`,
    verification_cancelled:
      '❎ Verification cancelled. You can type /verify whenever you are ready to try again.',
    button_wrong_user:
      '⛔ Only the Telegram account that started this verification can use these buttons.',
    button_expired:
      '⌛ This confirmation button has expired or was already used. Please type /verify to start again.',
    generic_error:
      '⚠️ An unexpected error occurred. Please try again in a moment.',
    help_student:
      'ℹ️ Available commands:\n/start - Start the bot & choose language\n/verify - Verify your student ID\n/language - Change your language (EN / FR / AR)'
  },

  fr: {
    welcome_select_language:
      '👋 Bienvenue sur le Bot de Vérification des Étudiants !\n\nVeuillez choisir votre langue :\nPlease select your preferred language:\nيرجى اختيار لغتك المفضلة:',
    language_saved:
      '🇫🇷 Langue définie sur Français.\n\nTapez /verify pour vérifier votre matricule étudiant, ou /language pour changer de langue à tout moment.',
    choose_language: '🌐 Veuillez choisir votre langue préférée :',
    private_only:
      '🔒 Pour votre confidentialité, veuillez utiliser la commande /verify en message privé avec le bot.',
    already_verified:
      "✅ Vous êtes déjà vérifié ! Si vous pensez qu'il s'agit d'une erreur, veuillez contacter un administrateur du groupe.",
    prompt_matricule:
      '🎓 Veuillez entrer votre matricule étudiant (ex. 232331001001) :',
    invalid_matricule_format:
      '⚠️ Format invalide. Veuillez entrer un matricule valide (4 à 20 caractères alphanumériques).',
    unknown_matricule:
      "❌ Ce matricule est introuvable dans la liste officielle des étudiants. Veuillez vérifier le numéro et réessayer avec /verify.",
    matricule_already_claimed:
      '❌ Ce matricule a déjà été réclamé par un autre compte Telegram.',
    confirm_identity: ({ fullName, matricule, section }) =>
      `🔎 Étudiant trouvé :\n\n👤 Nom complet : ${fullName}\n🆔 Matricule : ${matricule}\n🏫 Section : ${section || 'Général'}\n\nEst-ce bien vous ?`,
    btn_confirm: '✅ Confirmer, c’est moi',
    btn_cancel: '❌ Annuler',
    verification_success: ({ fullName, matricule }) =>
      `🎉 Vérification réussie !\n\nVotre compte Telegram est désormais lié de façon permanente à :\n👤 ${fullName} (${matricule})\n\nBienvenue dans la communauté !`,
    verification_cancelled:
      '❎ Vérification annulée. Vous pouvez taper /verify à tout moment pour recommencer.',
    button_wrong_user:
      '⛔ Seul le compte Telegram qui a lancé cette vérification peut utiliser ces boutons.',
    button_expired:
      '⌛ Ce bouton de confirmation a expiré ou a déjà été utilisé. Veuillez taper /verify pour recommencer.',
    generic_error:
      '⚠️ Une erreur inattendue est survenue. Veuillez réessayer dans un instant.',
    help_student:
      'ℹ️ Commandes disponibles :\n/start - Démarrer le bot et choisir la langue\n/verify - Vérifier votre matricule étudiant\n/language - Changer de langue (EN / FR / AR)'
  },

  ar: {
    welcome_select_language:
      '‏👋 مرحبًا بك في بوت توثيق الطلبة!\n\n‏يرجى اختيار لغتك المفضلة:\nVeuillez choisir votre langue :\nPlease select your preferred language:',
    language_saved:
      '‏🇩🇿 تم اختيار اللغة العربية.\n\n‏أرسل الأمر /verify لتوثيق رقم التسجيل الخاص بك (Matricule)، أو /language لتغيير اللغة في أي وقت.',
    choose_language: '‏🌐 يرجى اختيار لغتك المفضلة:',
    private_only:
      '‏🔒 حفاظًا على خصوصيتك، يرجى إرسال الأمر /verify في محادثة خاصة مع البوت.',
    already_verified:
      '✅ أنت موثّق بالفعل! إذا كنت تعتقد أن هناك خطأ، يرجى التواصل مع مشرف المجموعة.',
    prompt_matricule:
      '‏🎓 يرجى إدخال رقم التسجيل الخاص بك (مثال: 232331001001):',
    invalid_matricule_format:
      '‏⚠️ صيغة غير صحيحة. يرجى إدخال رقم تسجيل صحيح يتكون من أرقام أو حروف (من 4 إلى 20 رمزًا).',
    unknown_matricule:
      '‏❌ رقم التسجيل غير موجود في القائمة الرسمية للطلبة. يرجى التأكد من الرقم وإعادة المحاولة عبر /verify.',
    matricule_already_claimed:
      '‏❌ رقم التسجيل هذا مرتبط مسبقًا بحساب تيليجرام آخر.',
    confirm_identity: ({ fullName, matricule, section }) =>
      `‏🔎 تم العثور على بيانات الطالب:\n\n‏👤 الاسم الكامل: ${fullName}\n‏🆔 رقم التسجيل: ${matricule}\n‏🏫 الفوج / المجموعة: ${section || 'عام'}\n\n‏هل هذه بياناتك؟`,
    btn_confirm: '‏✅ تأكيد، هذا أنا',
    btn_cancel: '‏❌ إلغاء',
    verification_success: ({ fullName, matricule }) =>
      `‏🎉 تم التوثيق بنجاح!\n\n‏تم ربط حسابك في تيليجرام بشكل دائم بـ:\n‏👤 ${fullName} (${matricule})\n\n‏مرحبًا بك في المجموعة!`,
    verification_cancelled:
      '‏❎ تم إلغاء عملية التوثيق. يمكنك إرسال /verify في أي وقت للمحاولة مرة أخرى.',
    button_wrong_user:
      '‏⛔ فقط حساب تيليجرام الذي بدأ عملية التوثيق هذه يمكنه استخدام هذه الأزرار.',
    button_expired:
      '‏⌛ انتهت صلاحية زر التأكيد هذا أو تم استخدامه مسبقًا. يرجى إرسال /verify للبدء من جديد.',
    generic_error:
      '‏⚠️ حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى بعد قليل.',
    help_student:
      '‏ℹ️ الأوامر المتاحة:\n‏/start - بدء البوت واختيار اللغة\n‏/verify - توثيق رقم التسجيل للطالب\n‏/language - تغيير اللغة (EN / FR / AR)'
  }
};

export function t(lang, key, params = {}) {
  const safeLang = SUPPORTED_LANGUAGES.includes(lang) ? lang : 'fr';
  const entry = MESSAGES[safeLang][key] ?? MESSAGES.fr[key];
  if (typeof entry === 'function') {
    return entry(params);
  }
  return entry;
}

export function getLanguageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇬🇧 English', callback_data: 'lang:en' },
        { text: '🇫🇷 Français', callback_data: 'lang:fr' },
        { text: '🇩🇿 العربية', callback_data: 'lang:ar' }
      ]
    ]
  };
}

export function getConfirmKeyboard(lang, token) {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'btn_confirm'), callback_data: `confirm:${token}` },
        { text: t(lang, 'btn_cancel'), callback_data: `cancel:${token}` }
      ]
    ]
  };
}
