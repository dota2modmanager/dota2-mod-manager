/**
 * What this project costs, what it earns, and who pays for it.
 *
 * The page exists because two questions keep arriving in different words: "what is the catch"
 * and "how long will this be free". Both have the same answer, and the answer is more
 * believable as arithmetic than as a promise. Deadlock Mod Manager publishes the same page and
 * it is the most convincing thing on their site.
 *
 * Every number here is a number somebody could check: the domain price is public, the free
 * tiers are published, and the rest is one subscription. Nothing is rounded up to look
 * impressive and nothing is left out to look cheap.
 */
export const transparency = {
  en: {
    title: 'Transparency',
    description: 'What Dota 2 Mod Manager costs to run, what it earns, and who pays for it.',
    heading: 'What this costs and who pays',
    intro: 'Two questions arrive in different words: what is the catch, and how long will this stay free. '
      + 'Both are easier to answer with arithmetic than with a promise, so here is the arithmetic.',

    valuesHeading: 'What is fixed',
    values: [
      ['Free, with nothing held back', 'There is no paid version, no feature behind a login, and no plan for either. The program is GPL-3.0 and the whole of it is on GitHub.'],
      ['Nothing about you is collected', 'No analytics and no account needed to install a mod. The one thing the app reports is a download count per catalog mod, with no identifier, and it can be switched off. Every address the app can contact is listed, and the list is short.'],
      ['No advertising, and nothing sold', 'Not on the site, not in the app, not in the installer. The catalog belongs to its own authors and is not ours to sell.'],
    ],

    costHeading: 'What it costs to run',
    costNote: 'Per month, in euros, because that is what the largest line is billed in. The free tiers are the published ones, not a favour.',
    costs: [
      ['Domain', '€0.80', 'dota2modmanager.com, about $10.50 a year at Cloudflare Registrar, billed in dollars'],
      ['Site and CDN', '€0.00', 'Cloudflare Pages and Workers, free plan'],
      ['Mod and update mirror', '€0.00', 'Cloudflare R2, free up to 10 GB; 8.8 GB used'],
      ['Build machines', '€0.00', 'GitHub Actions, free for a public repository'],
      ['Code assistant', '€22.50', 'Claude Pro, after tax. The subscription this project is written with, said out loud because the README says so too'],
    ],
    costTotal: 'Total',

    incomeHeading: 'What it earns',
    income: 'Nothing. There is no revenue, no donation page, no sponsor paying for placement, and no affiliate link anywhere on this site or in the app. '
      + 'The difference comes out of the maintainer\'s pocket and has since July 2026.',

    helpHeading: 'What actually helps',
    help: [
      ['Report what broke, with the diagnostic file', 'Settings, Diagnostics, Export. It is a zip of what the app sees, and it turns a day of guessing into an afternoon of fixing.'],
      ['Star the repository', 'It costs nothing and it is the number every programme that gives things to open source looks at first.'],
      ['Translate it', 'The app speaks English and Russian. A third language is a pull request away.'],
      ['Tell somebody', 'A guide, a post, a comment under a video. That is how people found it so far.'],
    ],

    sponsorHeading: 'Sponsorship',
    sponsor: 'No money is accepted and none is asked for. What is useful is a service the project already needs: a code signing certificate, a status page, a translation platform. '
      + 'If you run one of those and it has a free tier for open source, write to hello@dota2modmanager.com and it will be credited here and in the README.',

    checkHeading: 'Checking any of this',
    check: 'The numbers about the program itself, the version, the mod count, the releases and the downloads, are on the facts page and are read from the catalog and the GitHub API at build time. '
      + 'Whether any of it is answering right now is on the status page at dota2modmanager.betteruptime.com, which checks the update feed, the mirror, the catalog and this site every three minutes. '
      + 'What the app does on a machine is in its security policy, and what it promises is in the assurance case.',
  },

  ru: {
    title: 'Прозрачность',
    description: 'Сколько стоит содержать Dota 2 Mod Manager, сколько он приносит и кто за это платит.',
    heading: 'Сколько это стоит и кто платит',
    intro: 'Два вопроса приходят разными словами: в чём подвох и надолго ли это бесплатно. '
      + 'На оба проще ответить арифметикой, чем обещанием, поэтому вот арифметика.',

    valuesHeading: 'Что не поменяется',
    values: [
      ['Бесплатно, без придержанного', 'Нет платной версии, нет функции за входом и нет планов ни на то, ни на другое. Программа под GPL-3.0, целиком на GitHub.'],
      ['Ничего о тебе не собирается', 'Ни аналитики, ни аккаунта ради установки мода. Единственное, о чём приложение сообщает, это счёт скачиваний по моду из каталога, без идентификатора, и его можно выключить. Все адреса, куда приложение вообще может пойти, перечислены, и список короткий.'],
      ['Ни рекламы, ни продаж', 'Ни на сайте, ни в приложении, ни в установщике. Каталог принадлежит своим авторам, и продавать его мы не вправе.'],
    ],

    costHeading: 'Во сколько обходится',
    costNote: 'В месяц, в евро, потому что в них выставлена самая большая строка. Бесплатные тарифы здесь обычные опубликованные, а не одолжение.',
    costs: [
      ['Домен', '€0.80', 'dota2modmanager.com, около 10,5 долларов в год в Cloudflare Registrar, счёт в долларах'],
      ['Сайт и CDN', '€0.00', 'Cloudflare Pages и Workers, бесплатный тариф'],
      ['Зеркало модов и обновлений', '€0.00', 'Cloudflare R2, бесплатно до 10 ГБ; занято 8,8 ГБ'],
      ['Сборочные машины', '€0.00', 'GitHub Actions, бесплатно для открытого репозитория'],
      ['Помощник для кода', '€22.50', 'Claude Pro, с налогами. Подписка, с которой пишется этот проект. Сказано вслух, потому что в README про это тоже сказано'],
    ],
    costTotal: 'Итого',

    incomeHeading: 'Сколько приносит',
    income: 'Ноль. Ни дохода, ни страницы пожертвований, ни спонсора за размещение, ни партнёрской ссылки где-либо на сайте или в приложении. '
      + 'Разницу платит автор из своего кармана, и так с июля 2026 года.',

    helpHeading: 'Что реально помогает',
    help: [
      ['Сообщать о поломке вместе с файлом диагностики', 'Настройки, Диагностика, Экспорт. Это архив с тем, что видит приложение, и он превращает день догадок в вечер починки.'],
      ['Поставить звезду репозиторию', 'Ничего не стоит, а это первое число, на которое смотрит любая программа, раздающая что-то открытым проектам.'],
      ['Перевести', 'Приложение говорит по-английски и по-русски. Третий язык это один pull request.'],
      ['Рассказать', 'Гайд, пост, комментарий под видео. Именно так о нём и узнавали до сих пор.'],
    ],

    sponsorHeading: 'Спонсорство',
    sponsor: 'Деньги не принимаются и не просятся. Полезно другое: услуга, которая проекту и так нужна, например сертификат для подписи кода, страница статуса, площадка для переводов. '
      + 'Если вы такое делаете и у вас есть бесплатный тариф для открытых проектов, напишите на hello@dota2modmanager.com, и это будет указано здесь и в README.',

    checkHeading: 'Как это проверить',
    check: 'Числа про саму программу, версия, количество модов, релизы и загрузки, лежат на странице фактов и подставляются из каталога и GitHub API при сборке. '
      + 'Отвечает ли всё это прямо сейчас, видно на странице статуса dota2modmanager.betteruptime.com: она раз в три минуты проверяет фид обновлений, зеркало, каталог и этот сайт. '
      + 'Что приложение делает с машиной, написано в политике безопасности, а что оно обещает, в assurance case.',
  },
} as const;
