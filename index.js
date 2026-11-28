// Requires discord.js 14.19 or newer:  npm install discord.js@latest
const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require('discord.js');

const TOKEN = process.env.TOKEN || 'YOUR_BOT_TOKEN';

// Files picked in /panel, kept until the edit window is submitted
const uploads = new Map();

function buildPanel({ title, image, code }) {
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`\`\`\`lua\n${code}\n\`\`\``),
    );
}

// ---------- Verify panel (button that grants a role) ----------
// The role id is stored inside the button's customId, so the button keeps
// working after the bot restarts and no database is needed.
function buildVerifyPanel({ title, description, label, roleId }) {
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`verify:${roleId}`)
          .setLabel(label)
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
      ),
    );
}

// ---------- Ticket system ----------
// Staff role and category are stored inside the button customIds, so the
// system keeps working after restarts and needs no database.
// Each ticket channel's topic is "ticket:<ownerId>", used to find the owner.
function buildTicketPanel({ title, description, label, staffRoleId, categoryId }) {
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:open:${staffRoleId}:${categoryId ?? '0'}`)
          .setLabel(label)
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary),
      ),
    );
}

function buildTicketWelcome({ user, staffRoleId }) {
  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎫 Ticket opened\nHello ${user}, describe your issue and <@&${staffRoleId}> will help you soon.`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:close:${staffRoleId}`)
          .setLabel('Close ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
      ),
    );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  const panel = new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Create or edit a panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption((o) => o.setName('file').setDescription('Image/GIF from your device'))
    .addBooleanOption((o) => o.setName('new').setDescription('Send a new panel instead of editing the latest one'));

  const verifySetup = new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Post a verification panel: click the button to get a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) =>
      o.setName('role').setDescription('Role given after verifying').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Panel title (default: Verification)').setMaxLength(200),
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('Panel description text').setMaxLength(1500),
    )
    .addStringOption((o) =>
      o.setName('button').setDescription('Button label (default: Verify)').setMaxLength(80),
    );

  const ticketSetup = new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Post a ticket panel: click the button to open a private ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) =>
      o.setName('staff').setDescription('Staff role that can see and close tickets').setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription('Category where ticket channels are created')
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Panel title (default: Support)').setMaxLength(200),
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('Panel description text').setMaxLength(1500),
    )
    .addStringOption((o) =>
      o.setName('button').setDescription('Button label (default: Open ticket)').setMaxLength(80),
    );

  await c.application.commands.set([panel.toJSON(), verifySetup.toJSON(), ticketSetup.toJSON()]);
  console.log(`Logged in as ${c.user.tag}`);
});

// Find the bot's latest panel (within the last 50 messages)
// Verify panels (they contain a button row) are skipped so /panel never edits them.
async function findPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  return messages.find(
    (m) =>
      m.author.id === client.user.id &&
      m.flags.has(MessageFlags.IsComponentsV2) &&
      !m.components[0]?.components?.some((p) => p.type === ComponentType.ActionRow),
  );
}

// Read the current values to prefill the edit window
function readPanel(message) {
  const parts = message?.components[0]?.components;
  if (!parts) return { title: '', image: '', code: '' };
  const text = parts.filter((p) => p.type === ComponentType.TextDisplay);
  const gallery = parts.find((p) => p.type === ComponentType.MediaGallery);
  return {
    title: text[0]?.content.replace(/^### /, '') ?? '',
    image: gallery?.items[0]?.media.url ?? '',
    code: text[1]?.content.replace(/^```lua\n|\n```$/g, '') ?? '',
  };
}

function input(id, label, value, max, style = TextInputStyle.Short) {
  const field = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setMaxLength(max)
    .setRequired(true);
  if (value) field.setValue(value.slice(0, max));
  return new ActionRowBuilder().addComponents(field);
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ---------- /verify-setup ----------
    if (interaction.isChatInputCommand() && interaction.commandName === 'verify-setup') {
      const role = interaction.options.getRole('role', true);
      const me = interaction.guild.members.me;

      // Check up front that the bot can actually hand this role out
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({
          content: 'The bot is missing the **Manage Roles** permission. Please grant it first.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (role.managed || role.id === interaction.guild.id || role.comparePositionTo(me.roles.highest) >= 0) {
        await interaction.reply({
          content: `The bot cannot give ${role}. Drag the bot's role **above** it in Server Settings → Roles (it also can't be @everyone or a bot/integration role).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const panel = buildVerifyPanel({
        title: interaction.options.getString('title') ?? 'Verification',
        description:
          interaction.options.getString('description') ??
          `Click the button below to verify and get the ${role} role.`,
        label: interaction.options.getString('button') ?? 'Verify',
        roleId: role.id,
      });

      await interaction.channel.send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
      });
      await interaction.reply({ content: 'Verification panel sent ✅', flags: MessageFlags.Ephemeral });
      return;
    }

    // ---------- Verify button ----------
    if (interaction.isButton() && interaction.customId.startsWith('verify:')) {
      const roleId = interaction.customId.split(':')[1];
      const role = interaction.guild.roles.cache.get(roleId);

      if (!role) {
        await interaction.reply({
          content: 'This role no longer exists (it may have been deleted). Please tell an admin.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.member.roles.cache.has(role.id)) {
        await interaction.reply({
          content: `You already have the ${role} role ✅`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.member.roles.add(role, 'Verified via button');
      await interaction.reply({
        content: `Verified! You now have the ${role} role 🎉`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ---------- /ticket-setup ----------
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
      const staff = interaction.options.getRole('staff', true);
      const category = interaction.options.getChannel('category');
      const me = interaction.guild.members.me;

      if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({
          content: 'The bot is missing the **Manage Channels** permission. Please grant it first.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const panel = buildTicketPanel({
        title: interaction.options.getString('title') ?? 'Support',
        description:
          interaction.options.getString('description') ??
          'Need help? Click the button below to open a private ticket with our staff.',
        label: interaction.options.getString('button') ?? 'Open ticket',
        staffRoleId: staff.id,
        categoryId: category?.id,
      });

      await interaction.channel.send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
      });
      await interaction.reply({ content: 'Ticket panel sent ✅', flags: MessageFlags.Ephemeral });
      return;
    }

    // ---------- Ticket: open ----------
    if (interaction.isButton() && interaction.customId.startsWith('ticket:open:')) {
      const [, , staffRoleId, categoryId] = interaction.customId.split(':');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // One open ticket per user
      const existing = interaction.guild.channels.cache.find(
        (ch) => ch.topic === `ticket:${interaction.user.id}`,
      );
      if (existing) {
        await interaction.editReply(`You already have an open ticket: ${existing}`);
        return;
      }

      const name = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '') || interaction.user.id}`;
      const channel = await interaction.guild.channels.create({
        name: name.slice(0, 90),
        type: ChannelType.GuildText,
        parent: categoryId !== '0' ? categoryId : null,
        topic: `ticket:${interaction.user.id}`,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          },
          {
            id: staffRoleId,
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
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ],
      });

      await channel.send({
        components: [buildTicketWelcome({ user: interaction.user, staffRoleId })],
        flags: MessageFlags.IsComponentsV2,
      });
      await interaction.editReply(`Your ticket is ready: ${channel}`);
      return;
    }

    // ---------- Ticket: close ----------
    if (interaction.isButton() && interaction.customId.startsWith('ticket:close:')) {
      const staffRoleId = interaction.customId.split(':')[2];
      const ownerId = interaction.channel.topic?.replace('ticket:', '');
      const isStaff =
        interaction.member.roles.cache.has(staffRoleId) ||
        interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);

      if (!isStaff && interaction.user.id !== ownerId) {
        await interaction.reply({
          content: 'Only the ticket owner or staff can close this ticket.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply(`🔒 Ticket closed by ${interaction.user}. This channel will be deleted in 5 seconds.`);
      setTimeout(() => interaction.channel.delete('Ticket closed').catch(console.error), 5000);
      return;
    }

    // ---------- /panel ----------
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
      const old = interaction.options.getBoolean('new')
        ? null
        : await findPanel(interaction.channel);
      const data = readPanel(old);

      const file = interaction.options.getAttachment('file');
      if (file && !file.contentType?.startsWith('image/')) {
        await interaction.reply({ content: 'The file must be an image or GIF.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (file) uploads.set(interaction.user.id, file.url);
      else uploads.delete(interaction.user.id);
      if (file) data.image = file.url;

      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`panel:${old?.id ?? 'new'}`)
          .setTitle(old ? 'Edit panel' : 'Create panel')
          .addComponents(
            ...[
              input('title', 'Title', data.title, 200),
              file ? null : input('image', 'Image/GIF link (https://...)', data.image, 1000),
              input('code', 'Code box text', data.code, 1800, TextInputStyle.Paragraph),
            ].filter(Boolean),
          ),
      );
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('panel:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const get = (id) => interaction.fields.getTextInputValue(id).trim();
      const uploaded = uploads.get(interaction.user.id);
      const hasImageField = interaction.fields.fields.has('image');
      const data = {
        title: get('title'),
        image: hasImageField ? get('image') : uploaded,
        code: get('code'),
      };

      if (!/^https?:\/\/\S+$/.test(data.image ?? '')) {
        await interaction.editReply('Use an http(s) image link, or run /panel again and attach a file.');
        return;
      }

      // Discord-hosted files are re-uploaded with the message so the link does not expire
      const files = [];
      const url = new URL(data.image);
      if (['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) {
        const ext = url.pathname.match(/\.(png|jpe?g|gif|webp)$/i)?.[0] ?? '.png';
        files.push(new AttachmentBuilder(data.image, { name: `panel${ext.toLowerCase()}` }));
        data.image = `attachment://${files[0].name}`;
      }

      const payload = {
        components: [buildPanel(data)],
        flags: MessageFlags.IsComponentsV2,
        files,
      };
      const id = interaction.customId.split(':')[1];

      if (id === 'new') await interaction.channel.send(payload);
      else await (await interaction.channel.messages.fetch(id)).edit({ ...payload, attachments: [] });

      await interaction.editReply('Done ✅');
    }
  } catch (error) {
    console.error(error);
    const msg = { content: 'Something went wrong. Check the permissions of the bot in this channel.', flags: MessageFlags.Ephemeral };
    const send = interaction.deferred
      ? interaction.editReply(msg.content)
      : interaction.replied
        ? interaction.followUp(msg)
        : interaction.reply(msg);
    await send.catch(() => {});
  }
});

client.login(TOKEN);
