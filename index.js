require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const API_KEY = process.env.API_KEY || "";
const API_BASE = process.env.API_BASE || "http://prem-eu3.bot-hosting.net:21693/api/q/aq";

const BANNER_URL =
    process.env.BANNER_URL ||
    "https://cdn.discordapp.com/attachments/1498985180633759804/1504391719226048603/1c22b9ddc074b2480799a3bf4a03f28c.jpg?ex=6a06d178&is=6a057ff8&hm=76ecf6bb07251a1eabe80f8db370b0965d48848f8601d3594b0ba0895c1b5fc4";

const cooldown = new Set();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

function truncate(str, max = 3800) {
    if (!str) return "";
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

async function apiRequest(endpoint, body) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
            "x-api-key": API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `HTTP Error ${response.status}`);
    }

    return data;
}

function createAutoQuestModal() {
    const tokenInput = new TextInputBuilder()
        .setCustomId("token")
        .setLabel("Discord Token")
        .setPlaceholder("Paste your Discord token here...")
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    return new ModalBuilder()
        .setCustomId("aq_auto_modal")
        .setTitle("🎉 Auto Quest")
        .addComponents(new ActionRowBuilder().addComponents(tokenInput));
}

function createDeleteTokenModal() {
    const tokenInput = new TextInputBuilder()
        .setCustomId("token")
        .setLabel("Discord Token")
        .setPlaceholder("Paste the token you want to clear...")
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    return new ModalBuilder()
        .setCustomId("aq_delete_modal")
        .setTitle("🗑️ Delete My Token")
        .addComponents(new ActionRowBuilder().addComponents(tokenInput));
}

client.once("ready", () => {
    console.log(`✨ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (msg.content.trim().toLowerCase() === "!aq") {
        const embed = new EmbedBuilder()
            .setColor("#E9A8C8")
            .setTitle("🍬 Mahiru")
            .setDescription(
                "✨ Auto Quest Service\n" +
                "✨ ONLINE 24/7 Mahiru"
            )
            .setImage(BANNER_URL)
            .setFooter({
                text: "By Mahiru"
            });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("btn_start_quest")
                .setLabel("* Auto Quest *")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("btn_delete_token")
                .setLabel("Delete My Token")
                .setEmoji("🗑️")
                .setStyle(ButtonStyle.Danger)
        );

        await msg.reply({
            embeds: [embed],
            components: [row]
        });
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
        if (interaction.customId !== "btn_start_quest" && interaction.customId !== "btn_delete_token") {
            return;
        }

        if (cooldown.has(interaction.user.id)) {
            return interaction.reply({
                content: "⏳ Please wait a moment before clicking again.",
                ephemeral: true
            });
        }

        cooldown.add(interaction.user.id);
        setTimeout(() => cooldown.delete(interaction.user.id), 3000);

        if (interaction.customId === "btn_start_quest") {
            return interaction.showModal(createAutoQuestModal());
        }

        if (interaction.customId === "btn_delete_token") {
            return interaction.showModal(createDeleteTokenModal());
        }
    }

    if (!interaction.isModalSubmit()) return;

    // 1. AUTO QUEST SUBMIT
    if (interaction.customId === "aq_auto_modal") {
        const token = interaction.fields.getTextInputValue("token").trim();
        await interaction.deferReply({ ephemeral: true });

        try {
            const loading = new EmbedBuilder()
                .setColor("#F4B8D1")
                .setTitle("🍬 Mahiru")
                .setDescription("⏳ Processing your quests, please wait...")
                .setFooter({ text: "By Mahiru" })
                .setTimestamp();

            await interaction.editReply({ embeds: [loading] });

            const data = await apiRequest("", { token });
            const stats = data.stats || {};
            const logs = (data.logs || [])
                .slice(-15)
                .map((x) => `• ${x.text || x}`)
                .join("\n");

            const result = new EmbedBuilder()
                .setColor((stats.failed || 0) > 0 ? "#F59E0B" : "#10B981")
                .setTitle("🍬 Mahiru • Quest Result")
                .setDescription("```text\n" + truncate(logs || "No logs available", 3000) + "\n```")
                .addFields(
                    { name: "✅ Success", value: String(stats.completed || 0), inline: true },
                    { name: "❌ Failed", value: String(stats.failed || 0), inline: true },
                    { name: "📌 Total", value: String(stats.total || 0), inline: true },
                    { name: "📡 Status", value: String(stats.status || "unknown"), inline: true },
                    { name: "💸 Cost", value: String(data.cost ?? 0), inline: true },
                    { name: "💰 Balance", value: String(data.balance ?? 0), inline: true }
                )
                .setFooter({ text: "By Mahiru" })
                .setTimestamp();

            await interaction.editReply({ embeds: [result] });
        } catch (err) {
            const errEmbed = new EmbedBuilder()
                .setColor("#EF4444")
                .setTitle("🍬 Mahiru • Error")
                .setDescription("```text\n" + truncate(err.message, 1500) + "\n```")
                .setFooter({ text: "By Mahiru" })
                .setTimestamp();

            await interaction.editReply({ embeds: [errEmbed] });
        }
    }

    // 2. DELETE MY TOKEN SUBMIT (clears modal input & confirms privacy)
    if (interaction.customId === "aq_delete_modal") {
        await interaction.reply({
            content: "🗑️ Your token input has been cleared and is never stored by this bot.",
            ephemeral: true
        });
    }
});

client.login(DISCORD_TOKEN);
