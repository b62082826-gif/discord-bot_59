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

// ---------- Verify panel (ปุ่มยืนยันตัวตนเพื่อรับยศ) ----------
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
    .setDescription('ส่งแผงยืนยันตัวตน กดปุ่มแล้วรับยศ')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) =>
      o.setName('role').setDescription('ยศที่จะให้เมื่อยืนยันสำเร็จ').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('หัวข้อ (ค่าเริ่มต้น: ยืนยันตัวตน)').setMaxLength(200),
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('ข้อความอธิบาย').setMaxLength(1500),
    )
    .addStringOption((o) =>
      o.setName('button').setDescription('ข้อความบนปุ่ม (ค่าเริ่มต้น: ยืนยัน)').setMaxLength(80),
    );

  await c.application.commands.set([panel.toJSON(), verifySetup.toJSON()]);
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
          content: 'บอทไม่มีสิทธิ์ **Manage Roles** กรุณาเพิ่มสิทธิ์ให้บอทก่อน',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (role.managed || role.id === interaction.guild.id || role.comparePositionTo(me.roles.highest) >= 0) {
        await interaction.reply({
          content: `บอทให้ยศ ${role} ไม่ได้ ต้องลากยศของบอทให้อยู่**สูงกว่า**ยศนี้ใน Server Settings → Roles (และห้ามเป็นยศ @everyone หรือยศของบอท/ระบบ)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const panel = buildVerifyPanel({
        title: interaction.options.getString('title') ?? 'ยืนยันตัวตน',
        description:
          interaction.options.getString('description') ??
          `กดปุ่มด้านล่างเพื่อยืนยันตัวตนและรับยศ ${role}`,
        label: interaction.options.getString('button') ?? 'ยืนยัน',
        roleId: role.id,
      });

      await interaction.channel.send({
        components: [panel],
        flags: MessageFlags.IsComponentsV2,
      });
      await interaction.reply({ content: 'ส่งแผงยืนยันตัวตนแล้ว ✅', flags: MessageFlags.Ephemeral });
      return;
    }

    // ---------- Verify button ----------
    if (interaction.isButton() && interaction.customId.startsWith('verify:')) {
      const roleId = interaction.customId.split(':')[1];
      const role = interaction.guild.roles.cache.get(roleId);

      if (!role) {
        await interaction.reply({
          content: 'ไม่พบยศนี้แล้ว (อาจถูกลบไป) กรุณาแจ้งแอดมิน',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.member.roles.cache.has(role.id)) {
        await interaction.reply({
          content: `คุณมียศ ${role} อยู่แล้ว ✅`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.member.roles.add(role, 'Verified via button');
      await interaction.reply({
        content: `ยืนยันสำเร็จ! คุณได้รับยศ ${role} แล้ว 🎉`,
        flags: MessageFlags.Ephemeral,
      });
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
