require('dotenv').config();

const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  GUILD_ID,
  SUPPORT_ROLE_ID,
  TICKET_CATEGORY_ID,
  TICKET_IMAGE_URL,
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const FENCE = '`'.repeat(3);
const COLOR = 0xff3b5c;

// ---------------------------------------------------------------------------
// Edit this list to change the rules panel
// ---------------------------------------------------------------------------
const RULES = [
  'Be respectful to everyone. No harassment, hate speech or drama.',
  'No spam, self-promotion or unsolicited ads.',
  'Keep every topic in the right channel.',
  'No illegal, harmful or NSFW content.',
  'Listen to the staff team. Their decision is final.',
  'Follow the Discord Terms of Service and Community Guidelines.',
];

// ---------------------------------------------------------------------------
// Ticket counter (saved to a file so numbers survive restarts)
// ---------------------------------------------------------------------------
const COUNTER_FILE = 'ticket_counters.json';

function loadCounter() {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).ticket || 0;
  } catch {
    return 0;
  }
}

let ticketCounter = loadCounter();

function nextTicketNumber() {
  ticketCounter += 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ ticket: ticketCounter }));
  return String(ticketCounter).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Application emojis (oh_*) are fetched by name on startup
// ---------------------------------------------------------------------------
function findEmoji(name) {
  return client.application?.emojis.cache.find((e) => e.name === name);
}

// "<:oh_rules:123>" string, or a unicode fallback if the emoji is missing
function emoji(name, fallback = '▫️') {
  const e = findEmoji(name);
  return e ? e.toString() : fallback;
}

// Object accepted by ButtonBuilder#setEmoji, or undefined if missing
function emojiObj(name) {
  const e = findEmoji(name);
  return e ? { id: e.id, name: e.name, animated: e.animated } : undefined;
}

function button(customId, label, style, emojiName) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  const eo = emojiName && emojiObj(emojiName);
  if (eo) b.setEmoji(eo);
  return b;
}

// ---------------------------------------------------------------------------
// UI building blocks (Components V2): every message is one container made of
// text, dividers, an optional image and buttons
// ---------------------------------------------------------------------------
const text = (content) => new TextDisplayBuilder().setContent(content);

const divider = (size = SeparatorSpacingSize.Large) =>
  new SeparatorBuilder().setDivider(true).setSpacing(size);

const card = () => new ContainerBuilder().setAccentColor(COLOR);

function addImage(container) {
  if (!TICKET_IMAGE_URL) return container;
  return container
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(TICKET_IMAGE_URL)),
    )
    .addSeparatorComponents(divider());
}

function send(channel, container, extra = {}) {
  return channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------
const adminOnly = PermissionFlagsBits.ManageGuild;

const roleCmd = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Post a role panel with buttons (up to 5 roles)')
  .setDefaultMemberPermissions(adminOnly)
  .addRoleOption((o) => o.setName('role1').setDescription('Role 1').setRequired(true));
for (let i = 2; i <= 5; i++) {
  roleCmd.addRoleOption((o) => o.setName(`role${i}`).setDescription(`Role ${i}`));
}

const commands = [
  roleCmd,
  new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Post the server rules in this channel')
    .setDefaultMemberPermissions(adminOnly),
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Post the ticket panel in this channel')
    .setDefaultMemberPermissions(adminOnly),
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Write and post an update announcement')
    .setDefaultMemberPermissions(adminOnly)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where to post (default: this channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) => o.setName('ping').setDescription('Add @here at the end')),
].map((c) => c.toJSON());

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
async function handleRulesCommand(interaction) {
  const lines = [
    `# ${emoji('oh_rules', '📜')} Server Rules`,
    '',
    ...RULES.map((r, i) => `${emoji('oh_check', '🎋')} **${i + 1}.** ${r}`),
  ];

  const container = card()
    .addTextDisplayComponents(text(lines.join('\n')))
    .addSeparatorComponents(divider(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text('-# By staying in this server you agree to follow these rules.'));

  await send(interaction.channel, container);
  await interaction.reply({ content: 'Rules posted.', flags: MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------------------
// Role panel
// ---------------------------------------------------------------------------
async function handleRolesCommand(interaction) {
  const roles = [];
  for (let i = 1; i <= 5; i++) {
    const r = interaction.options.getRole(`role${i}`);
    if (r && !roles.some((x) => x.id === r.id)) roles.push(r);
  }

  // Bot can only hand out roles that sit below its own highest role
  const me = interaction.guild.members.me;
  const blocked = roles.filter((r) => r.managed || r.position >= me.roles.highest.position);
  if (blocked.length) {
    return interaction.reply({
      content: `I can't assign: ${blocked.map((r) => r.name).join(', ')}. Move my role above them (and avoid bot-managed roles).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const icons = ['oh_community', 'oh_pings', 'oh_announce', 'oh_update', 'oh_check'];
  const row = new ActionRowBuilder().addComponents(
    roles.map((r, i) => button(`role:${r.id}`, r.name, ButtonStyle.Secondary, icons[i])),
  );

  const container = card()
    .addTextDisplayComponents(
      text(
        [
          `# ${emoji('oh_community', '🎋')} Get your roles`,
          `${emoji('oh_info', '🎋')} Press a button to get a role. Press it again to remove it.`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(row);

  await send(interaction.channel, container);
  await interaction.reply({ content: 'Role panel posted.', flags: MessageFlags.Ephemeral });
}

async function handleRoleButton(interaction) {
  const roleId = interaction.customId.split(':')[1];
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
  }

  const member = interaction.member;
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      await interaction.reply({ content: `Removed **${role.name}**.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(roleId);
      await interaction.reply({ content: `You now have **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: "I couldn't change that role. Check that my role is above it.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
function buildTicketPanel() {
  const e = emoji;
  const lines = [
    `# ${e('oh_ticket', '🎫')} Welcome to the ticket system`,
    'Please give us the full details of what you need, so the team can reply and help you faster.',
    '',
    `${e('oh_info', '🎋')} **What to tell us**`,
    `${e('oh_check', '🎋')} Type of request`,
    `${e('oh_check', '🎋')} Details of what you need`,
    `${e('oh_check', '🎋')} Deadline (if any)`,
    '',
    `${e('oh_rules', '🎋')} **Ticket rules**`,
    `${e('oh_check', '🎋')} Be polite and respectful`,
    `${e('oh_check', '🎋')} Do not spam or ping staff repeatedly`,
    `${e('oh_check', '🎋')} Wait for the team to answer in queue order`,
    `${e('oh_check', '🎋')} Check the result before you close the ticket`,
    '',
    `${e('oh_support', '🎋')} Open every day. The team replies as fast as it can.`,
  ];

  const container = card()
    .addTextDisplayComponents(text(lines.join('\n')))
    .addSeparatorComponents(divider());

  addImage(container);

  container
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button('ticket:open', 'Open ticket', ButtonStyle.Primary, 'oh_ticket'),
      ),
    )
    .addSeparatorComponents(divider(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text('-# Ticket system'));

  return container;
}

async function handleTicketPanelCommand(interaction) {
  await send(interaction.channel, buildTicketPanel());
  await interaction.reply({ content: 'Ticket panel posted.', flags: MessageFlags.Ephemeral });
}

async function handleTicketOpen(interaction) {
  const { guild, user } = interaction;

  const existing = guild.channels.cache.find((c) => c.topic === `ticket:${user.id}`);
  if (existing) {
    return interaction.reply({
      content: `You already have an open ticket: ${existing}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  if (SUPPORT_ROLE_ID) {
    overwrites.push({
      id: SUPPORT_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  const channel = await guild.channels.create({
    name: `${safeName}-${nextTicketNumber()}`,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    topic: `ticket:${user.id}`,
    permissionOverwrites: overwrites,
  });

  const container = card()
    .addTextDisplayComponents(
      text(
        [
          `# ${emoji('oh_ticket', '🎫')} Ticket opened`,
          `${emoji('oh_info', '🎋')} Opened by ${user}`,
          `${emoji('oh_wait', '🎋')} ${
            SUPPORT_ROLE_ID ? `<@&${SUPPORT_ROLE_ID}>` : 'The team'
          } will be with you soon. Please describe what you need.`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(divider())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button('ticket:close', 'Close ticket', ButtonStyle.Danger, 'oh_check'),
      ),
    );

  await send(channel, container, {
    allowedMentions: { users: [user.id], roles: SUPPORT_ROLE_ID ? [SUPPORT_ROLE_ID] : [] },
  });
  await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
}

async function handleTicketClose(interaction) {
  const channel = interaction.channel;
  const ownerId = channel.topic?.startsWith('ticket:') ? channel.topic.split(':')[1] : null;
  if (!ownerId) {
    return interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral });
  }

  const isOwner = interaction.user.id === ownerId;
  const isStaff = interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isStaff) {
    return interaction.reply({
      content: 'Only the ticket owner or staff can close this ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: `${emoji('oh_wait', '⏳')} Closing this ticket in 5 seconds...`,
    flags: MessageFlags.Ephemeral,
  });
  setTimeout(() => channel.delete().catch(console.error), 5000);
}

// ---------------------------------------------------------------------------
// Update announcer
// ---------------------------------------------------------------------------
async function handleUpdateCommand(interaction) {
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const ping = interaction.options.getBoolean('ping') ? '1' : '0';

  const modal = new ModalBuilder()
    .setCustomId(`update:${channel.id}:${ping}`)
    .setTitle('New update post');

  const field = (id, label, style, required, placeholder) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setPlaceholder(placeholder),
    );

  modal.addComponents(
    field('title', 'Title', TextInputStyle.Short, true, 'WebGrabber Pro - Update'),
    field('added', 'New (one item per line)', TextInputStyle.Paragraph, false, 'Auto-update | checks GitHub Releases on startup'),
    field('removed', 'Removed (one item per line)', TextInputStyle.Paragraph, false, 'Old feature | why it is gone'),
    field('fixes', 'Fixes & Improvements (one item per line)', TextInputStyle.Paragraph, false, 'Deploy fixed | the build now goes through'),
  );

  await interaction.showModal(modal);
}

function diffBlock(heading, lines, sign) {
  const items = lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!items.length) return '';
  return `**${heading}**\n${FENCE}diff\n${items.map((l) => `${sign} ${l}`).join('\n')}\n${FENCE}`;
}

async function handleUpdateModal(interaction) {
  const [, channelId, ping] = interaction.customId.split(':');
  const title = interaction.fields.getTextInputValue('title').trim();
  const added = interaction.fields.getTextInputValue('added');
  const removed = interaction.fields.getTextInputValue('removed');
  const fixes = interaction.fields.getTextInputValue('fixes');

  const sections = [
    diffBlock('New', added, '+'),
    diffBlock('Removed', removed, '-'),
    diffBlock('Fixes & Improvements', fixes, '+'),
  ].filter(Boolean);

  const total = title.length + sections.join('').length + 20;
  if (total > 3900) {
    return interaction.reply({
      content: `That post is about ${total} characters; the limit is about 4000. Please shorten it.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const target = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!target || !target.isTextBased()) {
    return interaction.reply({ content: "I can't reach that channel.", flags: MessageFlags.Ephemeral });
  }

  const container = card().addTextDisplayComponents(text(`# ${emoji('oh_update', '🔄')} ${title}`));
  sections.forEach((s) => {
    container.addSeparatorComponents(divider(SeparatorSpacingSize.Small)).addTextDisplayComponents(text(s));
  });
  if (ping === '1') {
    container.addSeparatorComponents(divider(SeparatorSpacingSize.Small)).addTextDisplayComponents(text('@here'));
  }

  await send(target, container, {
    allowedMentions: ping === '1' ? { parse: ['everyone'] } : { parse: [] },
  });
  await interaction.reply({ content: `Update posted in ${target}.`, flags: MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------------------
// Startup + routing
// ---------------------------------------------------------------------------
client.once('clientReady', async () => {
  try {
    await client.application.emojis.fetch();
    const count = client.application.emojis.cache.filter((e) => e.name.startsWith('oh_')).size;
    console.log(`Loaded ${count} oh_* application emojis.`);
  } catch (err) {
    console.error('Could not load application emojis, using fallbacks:', err.message);
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(commands);
  console.log(`Logged in as ${client.user.tag}. Slash commands registered.`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'rules':
          return await handleRulesCommand(interaction);
        case 'roles':
          return await handleRolesCommand(interaction);
        case 'ticket-panel':
          return await handleTicketPanelCommand(interaction);
        case 'update':
          return await handleUpdateCommand(interaction);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('role:')) return await handleRoleButton(interaction);
      if (interaction.customId === 'ticket:open') return await handleTicketOpen(interaction);
      if (interaction.customId === 'ticket:close') return await handleTicketClose(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('update:')) return await handleUpdateModal(interaction);
    }
  } catch (err) {
    console.error(err);
    const msg = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
