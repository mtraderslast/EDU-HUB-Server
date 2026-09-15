import nodemailer from "nodemailer";
import catchAsync from "../../utils/catchAsync.js";

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: "mzh.mmrahman@gmail.com",
        pass: "llac ubms yymp nuzt" // App Password
    }
});

export const contactEmail = catchAsync(async (req, res) => {
    const { name, email, issueCategory, issue, message } = req.body;

    const selectedIssue = issueCategory || issue;

    if (!name?.trim() || !email?.trim() || !selectedIssue || !message?.trim()) {
        return res.status(400).json({
            success: false,
            message: "Please fill in all required fields."
        });
    }

    const mailOptions = {
        from: `"${name}" <mzh.mmrahman@gmail.com>`,
        replyTo: email,
        to: "mzh.mmrahman@gmail.com",
        subject: `${selectedIssue.toUpperCase()} from ${name}`,
        html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f7f6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
          <h2 style="color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 10px;">New Contact Message</h2>
          
          <table style="width: 100%; margin-top: 20px; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; width: 30%;">Client Name:</td>
              <td style="padding: 8px 0;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Client Email:</td>
              <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #2563eb;">${email}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Requested issue:</td>
              <td style="padding: 8px 0;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${selectedIssue}</span></td>
            </tr>
          </table>

          <div style="margin-top: 20px; padding: 15px; background: #f8fafc; border-left: 4px solid #0891b2; border-radius: 4px;">
            <h4 style="margin: 0 0 10px 0; color: #475569;">Message Details:</h4>
            <p style="margin: 0; line-height: 1.6; white-space: pre-line;">${message}</p>
          </div>

          <p style="margin-top: 30px; font-size: 12px; color: #94a3b8; text-align: center;">
            This email was sent from your EDU-HUB Website contact form.
          </p>
        </div>
      </div>
    `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
        success: true,
        message: "Email sent successfully!"
    });
});