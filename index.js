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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  const command = new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Create or edit a panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption((o) => o.setName('file').setDescription('Image/GIF from your device'))
    .addBooleanOption((o) => o.setName('new').setDescription('Send a new panel instead of editing the latest one'));

  await c.application.commands.set([command.toJSON()]);
  console.log(`Logged in as ${c.user.tag}`);
});

// Find the bot's latest panel (within the last 50 messages)
async function findPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  return messages.find(
    (m) => m.author.id === client.user.id && m.flags.has(MessageFlags.IsComponentsV2),
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
    const send = interaction.deferred ? interaction.editReply(msg.content) : interaction.reply(msg);
    await send.catch(() => {});
  }
});

client.login(TOKEN);
